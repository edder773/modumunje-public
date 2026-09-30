import {
  APP_VERSION,
  BACKUP_TABLES,
  SCHEMA_VERSION,
  type AdminIdentity,
  type D1Row,
  allRows,
  allowedBackupTables,
  checksum,
  execute,
  firstRow,
  now,
} from "./admin-use-case-runtime";
import {
  BACKUP_MAX_PARTS,
  BACKUP_PAGE_ROWS,
  EXTERNAL_BACKUP_FORMAT,
  EXTERNAL_BACKUP_VERSION,
  backupPartGroups,
  backupStorageForMode,
  readAndVerifyBackupObject,
} from "./backup-storage";
import { BackupUploadQueue } from "./backup-upload-queue";
import type { BackupType } from "./admin-backup-use-cases";
import {
  claimBackupCreationStepLease,
  completeBackupCreationLease,
  expireStalledBackups,
} from "./backup-lifecycle";
import {
  type ExternalDescriptor,
  type ExternalManifestMetadata,
  type ExternalPart,
  cleanupKnownFailedPrefixes,
  createManifest,
  parseDescriptor,
  primaryKeys,
  removePrefix,
  stablePageQuery,
  validateExternalManifest,
  validateRowShape,
} from "./admin-external-backup-use-cases";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type ManualBackupProgress = {
  kind: "external-progress";
  format: typeof EXTERNAL_BACKUP_FORMAT;
  objectPrefix: string;
  type: BackupType;
  includeAnalytics: boolean;
  schemaVersion: string;
  appVersion: string;
  generatedAt: string;
  includedData: string[];
  phase: "collect" | "verify" | "publish";
  tableIndex: number;
  cursor: D1Row | null;
  partIndex: number;
  rowStart: number;
  verifiedPart: number;
  counts: Record<string, number>;
  parts: ExternalPart[];
  dataByteSize: number;
  revision: number;
  updatedAt: string;
};

// At most one 100-row page (and therefore at most 100 part uploads) per POST.
// This preserves the existing 800-part manifest ceiling for the full bank.
const MANUAL_BACKUP_PAGES_PER_REQUEST = 1;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

function manualProgress(value: string): ManualBackupProgress {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("백업 진행 상태가 유효하지 않습니다.");
  const state = parsed as ManualBackupProgress;
  if (
    state.kind !== "external-progress"
    || state.format !== EXTERNAL_BACKUP_FORMAT
    || !["collect", "verify", "publish"].includes(state.phase)
    || !Number.isSafeInteger(state.tableIndex)
    || state.tableIndex < 0
    || !Number.isSafeInteger(state.partIndex)
    || !Number.isSafeInteger(state.rowStart)
    || !Number.isSafeInteger(state.verifiedPart)
    || !Number.isSafeInteger(state.revision)
    || !Array.isArray(state.parts)
    || !Array.isArray(state.includedData)
    || !Object.hasOwn(BACKUP_TABLES, state.type)
    || typeof state.schemaVersion !== "string"
    || typeof state.appVersion !== "string"
    || state.includedData.some(table => typeof table !== "string")
    || state.tableIndex > state.includedData.length
    || state.parts.length > BACKUP_MAX_PARTS
    || !Number.isSafeInteger(state.dataByteSize)
    || state.dataByteSize < 0
    || !/^backups\/[a-f0-9-]{36}\/$/u.test(state.objectPrefix)
  ) throw new Error("백업 진행 상태가 유효하지 않습니다.");
  return state;
}

function pageCursor(table: string, row: D1Row): D1Row {
  return Object.fromEntries(primaryKeys(table).map(key => [key, row[key]]));
}

function backupProgressResponse(id: string, state: ManualBackupProgress) {
  return {
    id,
    type: state.type,
    source: "manual" as const,
    storageMode: "external" as const,
    completed: false,
    counts: state.counts,
    progress: {
      phase: state.phase,
      tableIndex: state.tableIndex,
      tableCount: state.includedData.length,
      partCount: state.parts.length,
      revision: state.revision,
    },
  };
}

class BackupSourceChanged extends Error {}

type ManualStepResult = ReturnType<typeof backupProgressResponse> | {
  id: string;
  type: BackupType;
  source: "manual";
  storageMode: "external";
  completed: true;
  counts: Record<string, number>;
  checksum: string;
  byteSize: number;
  createdAt: string;
};

export async function advanceManualExternalBackup(
  identity: AdminIdentity,
  type: BackupType,
  includeAnalytics: boolean,
  backupId: string,
) {
  if (!UUID_PATTERN.test(backupId)) throw new Error("백업 작업 ID가 유효하지 않습니다.");
  if (!Object.hasOwn(BACKUP_TABLES, type)) throw new Error("백업 유형이 유효하지 않습니다.");
  const storage = backupStorageForMode("external");
  if (!storage) throw new Error("외부 백업 저장소가 없습니다.");

  const load = () => firstRow<{
    status: string;
    payload: string;
    counts: string;
    checksum: string;
    byte_size: number;
    created_at: string;
    created_by_hash: string;
    backup_type: string;
    included_data: string;
  }>(`SELECT status, payload, counts, checksum, byte_size, created_at,
      created_by_hash, backup_type, included_data
      FROM backup_snapshots WHERE id = ?`, [backupId]);
  const already = await load();
  if (already && already.created_by_hash !== identity.hash) {
    throw new Error("다른 관리자의 백업 작업입니다.");
  }
  if (already?.status === "completed") {
    if (already.backup_type !== type
      || parseDescriptor(already.payload)?.objectPrefix !== `backups/${backupId}/`
      || already.included_data !== JSON.stringify(allowedBackupTables(type, includeAnalytics))) {
      throw new Error("백업 작업 범위가 최초 요청과 일치하지 않습니다.");
    }
    return {
      id: backupId, type, source: "manual" as const, storageMode: "external" as const,
      completed: true, counts: JSON.parse(already.counts) as Record<string, number>,
      checksum: already.checksum, byteSize: already.byte_size, createdAt: already.created_at,
    };
  }
  const leaseOwner = `backup-step:${crypto.randomUUID()}`;
  if (!await claimBackupCreationStepLease(leaseOwner)) {
    throw new Error("다른 백업 단계가 진행 중입니다. 잠시 후 같은 작업 ID로 이어서 진행하세요.");
  }
  let stepResult: ManualStepResult | undefined;
  let stepError: unknown;
  let observedPayload: string | null = null;
  let uncheckpointedKeys: string[] = [];
  try {
    await expireStalledBackups();
    let row = await load();
    observedPayload = row?.payload ?? null;
    if (!row) {
      await cleanupKnownFailedPrefixes(storage);
      const generatedAt = now();
      const includedData = allowedBackupTables(type, includeAnalytics);
      const objectPrefix = `backups/${backupId}/`;
      const state: ManualBackupProgress = {
        kind: "external-progress", format: EXTERNAL_BACKUP_FORMAT, objectPrefix,
        type, includeAnalytics, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION,
        generatedAt, includedData, phase: "collect",
        tableIndex: 0, cursor: null, partIndex: 0, rowStart: 0, verifiedPart: 0,
        counts: {}, parts: [], dataByteSize: 0, revision: 0, updatedAt: generatedAt,
      };
      await execute(`INSERT INTO backup_snapshots (
        id, backup_type, status, schema_version, app_version, included_data,
        counts, checksum, payload, byte_size, created_by_hash, created_at, error_message
      ) VALUES (?, ?, 'creating', ?, ?, ?, '{}', '', ?, 0, ?, ?, '')`, [
        backupId, type, SCHEMA_VERSION, APP_VERSION, JSON.stringify(includedData),
        JSON.stringify(state), identity.hash, generatedAt,
      ]);
      row = await load();
      observedPayload = row?.payload ?? null;
    }
    if (!row || row.created_by_hash !== identity.hash || row.backup_type !== type) {
      throw new Error("백업 작업 소유자 또는 유형이 일치하지 않습니다.");
    }
    if (row.status === "completed") {
      if (parseDescriptor(row.payload)?.objectPrefix !== `backups/${backupId}/`
        || row.included_data !== JSON.stringify(allowedBackupTables(type, includeAnalytics))) {
        throw new Error("백업 작업 범위가 최초 요청과 일치하지 않습니다.");
      }
      stepResult = {
        id: backupId, type, source: "manual", storageMode: "external",
        completed: true, counts: JSON.parse(row.counts) as Record<string, number>,
        checksum: row.checksum, byteSize: row.byte_size, createdAt: row.created_at,
      };
    } else {
      if (row.status !== "creating") {
        if (row.status === "failed") {
          try {
            const failedState = manualProgress(row.payload);
            if (failedState.objectPrefix === `backups/${backupId}/`) {
              await removePrefix(storage, failedState.objectPrefix);
            }
          } catch { /* The failed row stays unavailable even if cleanup must be retried. */ }
        }
        throw new Error("실패하거나 중단된 백업은 재개할 수 없습니다.");
      }
      let state = manualProgress(row.payload);
      if (state.type !== type || state.includeAnalytics !== includeAnalytics
        || state.objectPrefix !== `backups/${backupId}/`) {
        throw new Error("백업 작업 범위가 최초 요청과 일치하지 않습니다.");
      }
      if (state.schemaVersion !== SCHEMA_VERSION || state.appVersion !== APP_VERSION
        || JSON.stringify(state.includedData) !== JSON.stringify(allowedBackupTables(type, includeAnalytics))) {
        throw new BackupSourceChanged("백업 생성 중 소스·스키마 버전이 변경되었습니다.");
      }
      const save = async (next: ManualBackupProgress) => {
        next.revision = state.revision + 1;
        next.updatedAt = now();
        const serialized = JSON.stringify(next);
        const result = await execute(`UPDATE backup_snapshots
          SET payload = ?, counts = ?, byte_size = ?
          WHERE id = ? AND status = 'creating' AND payload = ?
            AND EXISTS (SELECT 1 FROM maintenance_runs WHERE task = 'backup_create'
              AND lease_owner = ? AND julianday(lease_until) > julianday('now'))`, [
          serialized, JSON.stringify(next.counts), next.dataByteSize, backupId, row!.payload, leaseOwner,
        ]);
        if (Number(result.meta.changes ?? 0) !== 1) {
          throw new Error("백업 진행 상태가 다른 요청과 충돌했습니다.");
        }
        state = next;
        row = { ...row!, payload: serialized };
        observedPayload = serialized;
        uncheckpointedKeys = [];
      };
      for (let pages = 0; pages < MANUAL_BACKUP_PAGES_PER_REQUEST && state.phase !== "publish"; pages += 1) {
        const next = structuredClone(state);
        const table = next.includedData[next.tableIndex];
        if (!table) {
          if (next.phase === "collect") {
            next.phase = "verify";
            next.tableIndex = 0;
            next.cursor = null;
            next.partIndex = 0;
            next.rowStart = 0;
          } else {
            if (next.verifiedPart !== next.parts.length) throw new BackupSourceChanged("백업 파트 수가 변경되었습니다.");
            next.phase = "publish";
          }
          await save(next);
          continue;
        }
        const query = stablePageQuery(table, next.cursor);
        const rows = await allRows(query.sql, query.values);
        for (const item of rows) validateRowShape(table, item);
        const groups = backupPartGroups(rows);
        if (next.phase === "collect") {
          const uploads = new BackupUploadQueue();
          try {
            for (const group of groups) {
              if (next.parts.length >= BACKUP_MAX_PARTS) throw new Error("외부 백업 파트 제한을 초과했습니다.");
              const metadata = {
                table, partIndex: next.partIndex, rowStart: next.rowStart, rowCount: group.length,
              };
              const body = textEncoder.encode(JSON.stringify(group));
              // Never reuse a part key after a failed page or an expired lease.
              // A late R2 PUT from an earlier request must not overwrite bytes
              // referenced by a later, successfully published manifest.
              const objectKey = `${next.objectPrefix}parts/${table}-${String(next.partIndex).padStart(5, "0")}-${crypto.randomUUID()}.json`;
              uncheckpointedKeys.push(objectKey);
              const position = next.parts.length;
              next.parts.push({ ...metadata, objectKey, byteSize: body.byteLength, checksum: "" });
              next.dataByteSize += body.byteLength;
              next.partIndex += 1;
              next.rowStart += group.length;
              await uploads.add(body.byteLength, async () => {
                const receipt = await storage.put(objectKey, body);
                await readAndVerifyBackupObject(storage, receipt);
                next.parts[position] = { ...receipt, ...metadata };
              });
            }
            await uploads.drain();
          } finally {
            await uploads.settled();
          }
        } else {
          for (const group of groups) {
            const expected = next.parts[next.verifiedPart];
            const body = textEncoder.encode(JSON.stringify(group));
            const actual = await checksum(textDecoder.decode(body));
            if (!expected || expected.table !== table || expected.partIndex !== next.partIndex
              || expected.rowStart !== next.rowStart || expected.rowCount !== group.length
              || expected.byteSize !== body.byteLength || expected.checksum !== actual) {
              throw new BackupSourceChanged("백업 생성 중 원본 데이터가 변경되었습니다.");
            }
            next.verifiedPart += 1;
            next.partIndex += 1;
            next.rowStart += group.length;
          }
        }
        if (rows.length) next.cursor = pageCursor(table, rows.at(-1)!);
        if (rows.length < BACKUP_PAGE_ROWS) {
          if (next.phase === "collect") next.counts[table] = next.rowStart;
          else if (next.counts[table] !== next.rowStart) {
            throw new BackupSourceChanged("백업 생성 중 원본 데이터 건수가 변경되었습니다.");
          }
          next.tableIndex += 1;
          next.cursor = null;
          next.partIndex = 0;
          next.rowStart = 0;
        }
        await save(next);
      }
      if (state.phase === "publish") {
        const manifestKey = `${state.objectPrefix}manifest-${crypto.randomUUID()}.json`;
        const metadata: ExternalManifestMetadata = {
          backupVersion: EXTERNAL_BACKUP_VERSION, appVersion: APP_VERSION,
          schemaVersion: SCHEMA_VERSION, type, source: "manual",
          generatedAt: state.generatedAt, includedData: state.includedData,
          counts: state.counts, storageFormat: EXTERNAL_BACKUP_FORMAT,
        };
        const manifest = await createManifest(metadata, state.parts);
        uncheckpointedKeys.push(manifestKey);
        const manifestReceipt = await storage.put(manifestKey, textEncoder.encode(JSON.stringify(manifest)));
        await readAndVerifyBackupObject(storage, manifestReceipt);
        await validateExternalManifest(manifest);
        const descriptor: ExternalDescriptor = {
          kind: "external", format: EXTERNAL_BACKUP_FORMAT,
          objectPrefix: state.objectPrefix, manifest: manifestReceipt,
        };
        const byteSize = state.dataByteSize + manifestReceipt.byteSize;
        const published = await execute(`UPDATE backup_snapshots
          SET status = 'completed', counts = ?, checksum = ?, payload = ?,
              byte_size = ?, error_message = ''
          WHERE id = ? AND status = 'creating' AND payload = ?
            AND EXISTS (SELECT 1 FROM maintenance_runs WHERE task = 'backup_create'
              AND lease_owner = ? AND julianday(lease_until) > julianday('now'))`, [
          JSON.stringify(state.counts), manifest.metadata.checksum,
          JSON.stringify(descriptor), byteSize, backupId, row!.payload, leaseOwner,
        ]);
        if (Number(published.meta.changes ?? 0) !== 1) {
          throw new Error("외부 백업 완료 상태를 원자적으로 게시하지 못했습니다.");
        }
        uncheckpointedKeys = [];
        // Only the published descriptor owns this prefix now. Orphans from
        // interrupted attempts may be removed after publication; cleanup is
        // best effort and must not turn a completed snapshot into a failure.
        try {
          const referenced = new Set([...state.parts.map(part => part.objectKey), manifestKey]);
          const orphans = (await storage.list(state.objectPrefix))
            .filter(key => key.startsWith(state.objectPrefix) && !referenced.has(key));
          for (let start = 0; start < orphans.length; start += 100) {
            await storage.delete(orphans.slice(start, start + 100));
          }
        } catch { /* An interrupted cleanup cannot invalidate published bytes. */ }
        stepResult = {
          id: backupId, type, source: "manual", storageMode: "external",
          completed: true, counts: state.counts, checksum: manifest.metadata.checksum,
          byteSize, createdAt: state.generatedAt,
        };
      } else stepResult = backupProgressResponse(backupId, state);
    }
  } catch (error) {
    stepError = error;
    // A late writer owns only its unique uncheckpointed keys. Never remove a
    // shared prefix here: a newer lease holder may have completed the backup.
    if (uncheckpointedKeys.length) {
      for (let start = 0; start < uncheckpointedKeys.length; start += 100) {
        await storage.delete(uncheckpointedKeys.slice(start, start + 100)).catch(() => undefined);
      }
    }
    try {
      if (error instanceof BackupSourceChanged) {
        if (observedPayload) {
          const failed = await execute(`UPDATE backup_snapshots SET status = 'failed', error_message = ?
            WHERE id = ? AND status = 'creating' AND payload = ?
              AND EXISTS (SELECT 1 FROM maintenance_runs WHERE task = 'backup_create'
                AND lease_owner = ? AND julianday(lease_until) > julianday('now'))`,
          [error.message, backupId, observedPayload, leaseOwner]);
          if (Number(failed.meta.changes ?? 0) === 1) {
            await removePrefix(storage, `backups/${backupId}/`).catch(() => undefined);
          }
        }
      }
    } catch (cleanupError) {
      stepError = cleanupError;
    }
  }
  // A completed snapshot remains a success even if lease cleanup fails.
  await completeBackupCreationLease(leaseOwner).catch(() => undefined);
  if (stepError) throw stepError;
  return stepResult!;
}

export async function cancelManualExternalBackup(identity: AdminIdentity, backupId: string) {
  if (!UUID_PATTERN.test(backupId)) throw new Error("백업 작업 ID가 유효하지 않습니다.");
  const leaseOwner = `backup-cancel:${crypto.randomUUID()}`;
  if (!await claimBackupCreationStepLease(leaseOwner)) {
    throw new Error("백업 단계가 진행 중입니다. 완료 후 취소해 주세요.");
  }
  try {
    const row = await firstRow<{ payload: string; status: string; created_by_hash: string }>(
      "SELECT payload, status, created_by_hash FROM backup_snapshots WHERE id = ?", [backupId],
    );
    if (!row || row.created_by_hash !== identity.hash) throw new Error("백업 작업을 찾을 수 없습니다.");
    if (row.status === "completed") throw new Error("완료된 백업은 작업 취소할 수 없습니다.");
    if (row.status === "creating") {
      const state = manualProgress(row.payload);
      if (state.objectPrefix !== `backups/${backupId}/`) throw new Error("백업 저장 경로가 일치하지 않습니다.");
      const failed = await execute(`UPDATE backup_snapshots SET status = 'failed', error_message = '관리자가 백업 작업을 취소했습니다.'
        WHERE id = ? AND status = 'creating' AND payload = ?`, [backupId, row.payload]);
      if (Number(failed.meta.changes ?? 0) !== 1) throw new Error("백업 취소 상태가 다른 요청과 충돌했습니다.");
      const storage = backupStorageForMode("external");
      if (storage) await removePrefix(storage, state.objectPrefix);
    } else if (row.status === "failed") {
      const state = manualProgress(row.payload);
      if (state.objectPrefix !== `backups/${backupId}/`) throw new Error("백업 저장 경로가 일치하지 않습니다.");
      const storage = backupStorageForMode("external");
      if (storage) await removePrefix(storage, state.objectPrefix);
    }
    return { id: backupId, canceled: true };
  } finally {
    await completeBackupCreationLease(leaseOwner).catch(() => undefined);
  }
}
