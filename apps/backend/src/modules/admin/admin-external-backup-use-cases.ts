import { GROUP_OWNER_SLOT_RECOVERY_SQL } from "@shared/admin/group-owner-slot-recovery.mjs";
import { backupTableSpec, supportedBackupSchema } from "@shared/admin/backup-contract.mjs";
import { IMMUTABLE_PERSONAL_TABLES, immutablePersonalConflictAction, verifyImmutablePersonalRows } from "./admin-backup-personal-immutability";
import {
  APP_VERSION,
  BACKUP_DELETE_ORDER,
  BACKUP_INSERT_ORDER,
  BACKUP_TABLES,
  type AdminIdentity,
  type D1Row,
  RESTORABLE_TABLES,
  SCHEMA_VERSION,
  type SqlCommand,
  adminRepository,
  allRows,
  allowedBackupTables,
  checksum,
  compactText,
  errorMessage,
  execute,
  firstRow,
  now,
} from "./admin-use-case-runtime";
import { restoredContentRows } from "./admin-backup-restore-content";
import {
  BACKUP_MAX_PARTS,
  BACKUP_PART_MAX_BYTES,
  BACKUP_PAGE_ROWS,
  EXTERNAL_BACKUP_FORMAT,
  EXTERNAL_BACKUP_VERSION,
  type BackupObjectReceipt,
  type BackupStorage,
  backupPartGroups,
  backupStorageForMode,
  readAndVerifyBackupObject,
} from "./backup-storage";
import {
  claimRestoreLease,
  completeRestoreLease,
  failRestoreLease,
} from "./backup-lifecycle";

import { BackupUploadQueue } from "./backup-upload-queue";

type BackupType = keyof typeof BACKUP_TABLES;
type BackupSource = "manual" | "automatic" | "pre-restore";

export type ExternalPart = BackupObjectReceipt & {
  table: string;
  partIndex: number;
  rowStart: number;
  rowCount: number;
};

export type ExternalManifestMetadata = {
  backupVersion: string;
  appVersion: string;
  schemaVersion: string;
  type: BackupType;
  source: BackupSource;
  generatedAt: string;
  includedData: string[];
  counts: Record<string, number>;
  storageFormat: typeof EXTERNAL_BACKUP_FORMAT;
};

export type ExternalBackupManifest = {
  format: typeof EXTERNAL_BACKUP_FORMAT;
  metadata: ExternalManifestMetadata & { checksum: string };
  parts: ExternalPart[];
};

export type ExternalDescriptor = {
  kind: "external";
  format: typeof EXTERNAL_BACKUP_FORMAT;
  objectPrefix: string;
  manifest: BackupObjectReceipt;
};

export type ExternalBackupSnapshot = {
  id: string;
  backup_type: string;
  created_at: string;
  descriptor: ExternalDescriptor;
  manifest: ExternalBackupManifest;
  storage: BackupStorage;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function scopedManifestKey(prefix: string, key: string) {
  return key === `${prefix}manifest.json`
    || (key.startsWith(`${prefix}manifest-`)
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/iu
        .test(key.slice((`${prefix}manifest-`).length)));
}

function quoted(value: string) {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) throw new Error(`안전하지 않은 백업 식별자입니다: ${value}`);
  return `\`${value}\``;
}

export function primaryKeys(table: string) {
  const spec = RESTORABLE_TABLES[table];
  if (!spec) throw new Error(`${table} 데이터는 복원할 수 없습니다.`);
  return Array.isArray(spec.primaryKey) ? spec.primaryKey : [spec.primaryKey];
}

export function stablePageQuery(table: string, cursor: D1Row | null) {
  const keys = primaryKeys(table);
  const columns = RESTORABLE_TABLES[table].columns.map(quoted).join(", ");
  const values: unknown[] = [];
  let where = "";
  if (cursor) {
    const comparisons: string[] = [];
    for (let index = 0; index < keys.length; index += 1) {
      const equals = keys.slice(0, index).map((key) => {
        values.push(cursor[key]);
        return `${quoted(key)} = ?`;
      });
      values.push(cursor[keys[index]]);
      comparisons.push(`(${[...equals, `${quoted(keys[index])} > ?`].join(" AND ")})`);
    }
    where = `WHERE ${comparisons.join(" OR ")}`;
  }
  values.push(BACKUP_PAGE_ROWS);
  return {
    sql: `SELECT ${columns} FROM ${quoted(table)} ${where} ORDER BY ${keys.map(quoted).join(", ")} LIMIT ?`,
    values,
  };
}

export function validateRowShape(table: string, row: D1Row, schemaVersion = SCHEMA_VERSION) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${table} 백업 파트에 객체가 아닌 행이 있습니다.`);
  }
  const actual = Object.keys(row).sort();
  const spec = backupTableSpec(table, schemaVersion);
  if (!spec) throw new Error(`${table} 백업 계약이 없습니다.`);
  const expected = [...spec.columns].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${table} 백업 행의 스키마가 현재 복원 계약과 다릅니다.`);
  }
}

async function scanStableTable(
  table: string,
  visit: (rows: D1Row[], partIndex: number, rowStart: number) => Promise<void>,
) {
  let cursor: D1Row | null = null;
  let partIndex = 0;
  let rowStart = 0;
  while (true) {
    const query = stablePageQuery(table, cursor);
    const page = await allRows(query.sql, query.values);
    if (!page.length) break;
    for (const row of page) validateRowShape(table, row);
    for (const rows of backupPartGroups(page)) {
      await visit(rows, partIndex, rowStart);
      partIndex += 1;
      rowStart += rows.length;
    }
    cursor = page.at(-1) ?? null;
    if (page.length < BACKUP_PAGE_ROWS) break;
  }
  return { partCount: partIndex, rowCount: rowStart };
}

function publicPart(part: ExternalPart) {
  return {
    table: part.table,
    partIndex: part.partIndex,
    rowStart: part.rowStart,
    rowCount: part.rowCount,
    byteSize: part.byteSize,
    checksum: part.checksum,
  };
}

function manifestDigestBase(manifest: Omit<ExternalBackupManifest, "metadata"> & {
  metadata: ExternalManifestMetadata;
}) {
  return JSON.stringify({
    format: manifest.format,
    metadata: manifest.metadata,
    parts: manifest.parts.map(publicPart),
  });
}

export async function createManifest(
  metadata: ExternalManifestMetadata,
  parts: ExternalPart[],
): Promise<ExternalBackupManifest> {
  const base = { format: EXTERNAL_BACKUP_FORMAT, metadata, parts } as const;
  return {
    ...base,
    metadata: { ...metadata, checksum: await checksum(manifestDigestBase(base)) },
  };
}

export function parseDescriptor(value: unknown): ExternalDescriptor | null {
  if (typeof value !== "string" || !value.startsWith("{")) return null;
  let parsed: Partial<ExternalDescriptor>;
  try {
    parsed = JSON.parse(value) as Partial<ExternalDescriptor>;
  } catch {
    return null;
  }
  if (
    parsed.kind !== "external"
    || parsed.format !== EXTERNAL_BACKUP_FORMAT
    || typeof parsed.objectPrefix !== "string"
    || !parsed.manifest
    || typeof parsed.manifest.objectKey !== "string"
    || !Number.isInteger(parsed.manifest.byteSize)
    || !/^[a-f0-9]{64}$/u.test(String(parsed.manifest.checksum ?? ""))
  ) return null;
  return parsed as ExternalDescriptor;
}

export async function validateExternalManifest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("외부 백업 매니페스트 형식이 유효하지 않습니다.");
  }
  const manifest = value as ExternalBackupManifest;
  if (manifest.format !== EXTERNAL_BACKUP_FORMAT || !manifest.metadata || !Array.isArray(manifest.parts)) {
    throw new Error("외부 백업 매니페스트 형식이 유효하지 않습니다.");
  }
  const { checksum: expectedChecksum, ...metadata } = manifest.metadata;
  if (metadata.backupVersion !== EXTERNAL_BACKUP_VERSION) {
    throw new Error(`지원하지 않는 외부 백업 버전입니다: ${metadata.backupVersion}`);
  }
  if (
    metadata.storageFormat !== EXTERNAL_BACKUP_FORMAT
    || typeof metadata.appVersion !== "string"
    || !metadata.appVersion
    || !Number.isFinite(Date.parse(metadata.generatedAt))
  ) throw new Error("외부 백업 형식 또는 생성 정보가 유효하지 않습니다.");
  if (!supportedBackupSchema(metadata.schemaVersion)) {
    throw new Error(`스키마 버전이 다릅니다. 현재 지원 버전: ${SCHEMA_VERSION}`);
  }
  if (!Object.hasOwn(BACKUP_TABLES, metadata.type)) throw new Error("백업 유형이 유효하지 않습니다.");
  if (!["manual", "automatic", "pre-restore"].includes(metadata.source)) {
    throw new Error("백업 생성 출처가 유효하지 않습니다.");
  }
  if (
    !Array.isArray(metadata.includedData)
    || new Set(metadata.includedData).size !== metadata.includedData.length
  ) throw new Error("백업 데이터 범위가 유효하지 않습니다.");
  const permitted = new Set(allowedBackupTables(metadata.type, metadata.includedData.includes("analytics_events"), metadata.schemaVersion));
  if (metadata.includedData.some((table) => !permitted.has(table) || !backupTableSpec(table, metadata.schemaVersion))) {
    throw new Error("외부 백업에 허용되지 않은 테이블이 있습니다.");
  }
  if (
    !metadata.counts
    || typeof metadata.counts !== "object"
    || JSON.stringify(Object.keys(metadata.counts).sort()) !== JSON.stringify([...metadata.includedData].sort())
  ) {
    throw new Error("외부 백업 건수 정보가 없습니다.");
  }
  let previousTableIndex = -1;
  let expectedPartIndex = 0;
  const observedCounts: Record<string, number> = Object.fromEntries(
    metadata.includedData.map((table) => [table, 0]),
  );
  if (manifest.parts.length > BACKUP_MAX_PARTS) throw new Error("외부 백업 파트 수가 안전 제한을 초과합니다.");
  for (const part of manifest.parts) {
    const tableIndex = metadata.includedData.indexOf(part.table);
    if (tableIndex < 0 || tableIndex < previousTableIndex) throw new Error("백업 파트 테이블 순서가 유효하지 않습니다.");
    if (tableIndex !== previousTableIndex) expectedPartIndex = 0;
    if (
      part.partIndex !== expectedPartIndex
      || part.rowStart !== observedCounts[part.table]
      || !Number.isInteger(part.rowCount)
      || part.rowCount < 1
      || !Number.isInteger(part.byteSize)
      || part.byteSize < 2
      || part.byteSize > BACKUP_PART_MAX_BYTES
      || !/^[a-f0-9]{64}$/u.test(part.checksum)
      || typeof part.objectKey !== "string"
    ) throw new Error("백업 파트 순서 또는 무결성 정보가 유효하지 않습니다.");
    observedCounts[part.table] += part.rowCount;
    previousTableIndex = tableIndex;
    expectedPartIndex += 1;
  }
  for (const table of metadata.includedData) {
    if (Number(metadata.counts[table]) !== observedCounts[table]) {
      throw new Error(`${table} 백업 건수가 파트 합계와 일치하지 않습니다.`);
    }
  }
  const actualChecksum = await checksum(manifestDigestBase({
    format: manifest.format,
    metadata,
    parts: manifest.parts,
  }));
  if (!expectedChecksum || expectedChecksum !== actualChecksum) {
    throw new Error("외부 백업 매니페스트 무결성 검증값이 일치하지 않습니다.");
  }
  return manifest;
}

async function readPartRows(source: ExternalBackupSnapshot, part: ExternalPart) {
  if (!part.objectKey.startsWith(source.descriptor.objectPrefix)) {
    throw new Error("백업 파트 경로가 백업 전용 범위를 벗어났습니다.");
  }
  const body = await readAndVerifyBackupObject(source.storage, part, BACKUP_PART_MAX_BYTES);
  let rows: unknown;
  try {
    rows = JSON.parse(textDecoder.decode(body));
  } catch {
    throw new Error(`${part.table} 백업 파트 JSON이 손상되었습니다.`);
  }
  if (!Array.isArray(rows) || rows.length !== part.rowCount) {
    throw new Error(`${part.table} 백업 파트 건수가 일치하지 않습니다.`);
  }
  for (const row of rows) validateRowShape(part.table, row as D1Row, source.manifest.metadata.schemaVersion);
  return rows as D1Row[];
}

function parsePortablePartRows(table: string, body: Uint8Array, rowCount: number, schemaVersion: string) {
  let rows: unknown;
  try {
    rows = JSON.parse(textDecoder.decode(body));
  } catch {
    throw new Error(`${table} 백업 파트 JSON이 손상되었습니다.`);
  }
  if (!Array.isArray(rows) || rows.length !== rowCount) {
    throw new Error(`${table} 백업 파트 건수가 일치하지 않습니다.`);
  }
  for (const row of rows) validateRowShape(table, row as D1Row, schemaVersion);
  return rows as D1Row[];
}

export async function removePrefix(storage: BackupStorage, prefix: string) {
  if (!/^backups\/[a-f0-9-]{36}\/$/u.test(prefix)) {
    throw new Error("백업 객체 삭제 범위가 안전하지 않습니다.");
  }
  const keys = await storage.list(prefix);
  for (let start = 0; start < keys.length; start += 100) {
    await storage.delete(keys.slice(start, start + 100));
  }
}

export async function cleanupKnownFailedPrefixes(storage: BackupStorage) {
  const failed = await allRows<{ id: string; payload: string }>(`
    SELECT id, payload FROM backup_snapshots
    WHERE status = 'failed' AND (
      payload LIKE '{"kind":"external"%'
      OR payload LIKE '{"kind":"external-progress"%'
    )
    ORDER BY created_at LIMIT 20
  `);
  for (const row of failed) {
    const descriptor = parseDescriptor(row.payload);
    let prefix = descriptor?.objectPrefix;
    if (!prefix) {
      try {
        const progress = JSON.parse(row.payload) as { kind?: string; objectPrefix?: string };
        if (progress.kind === "external-progress") prefix = progress.objectPrefix;
      } catch { /* A malformed historical descriptor is not a deletion target. */ }
    }
    if (prefix === `backups/${row.id}/`) {
      await removePrefix(storage, prefix).catch(() => undefined);
    }
  }
}

export async function createExternalBackup(
  identity: AdminIdentity,
  type: BackupType,
  options: { includeAnalytics?: boolean; source?: BackupSource } = {},
) {
  const storage = backupStorageForMode("external");
  if (!storage) throw new Error("외부 백업 저장소가 없습니다.");
  await cleanupKnownFailedPrefixes(storage);
  const source = options.source ?? "manual";
  const tables = allowedBackupTables(type, options.includeAnalytics);
  const id = crypto.randomUUID();
  const generatedAt = now();
  const backupType = source === "automatic"
    ? `auto-${type}`
    : source === "pre-restore" ? `pre-restore-${type}` : type;
  const objectPrefix = `backups/${id}/`;
  const manifestKey = `${objectPrefix}manifest.json`;
  const initialDescriptor: ExternalDescriptor = {
    kind: "external",
    format: EXTERNAL_BACKUP_FORMAT,
    objectPrefix,
    manifest: { objectKey: manifestKey, byteSize: 0, checksum: "0".repeat(64) },
  };
  await execute(`
    INSERT INTO backup_snapshots (
      id, backup_type, status, schema_version, app_version, included_data,
      counts, checksum, payload, byte_size, created_by_hash, created_at,
      error_message
    ) VALUES (?, ?, 'creating', ?, ?, ?, '{}', '', ?, 0, ?, ?, '')
  `, [id, backupType, SCHEMA_VERSION, APP_VERSION, JSON.stringify(tables), JSON.stringify(initialDescriptor), identity.hash, generatedAt]);

  const uploads = new BackupUploadQueue();
  try {
    const parts: ExternalPart[] = [];
    const counts: Record<string, number> = {};
    let dataByteSize = 0;
    let maxBufferedBytes = 0;
    for (const table of tables) {
      const scanned = await scanStableTable(table, async (rows, partIndex, rowStart) => {
        if (parts.length >= BACKUP_MAX_PARTS) {
          throw new Error(`외부 백업 파트 제한 ${BACKUP_MAX_PARTS}개를 초과했습니다. 재개형 작업이 필요합니다.`);
        }
        const body = textEncoder.encode(JSON.stringify(rows));
        maxBufferedBytes = Math.max(maxBufferedBytes, body.byteLength);
        const objectKey = `${objectPrefix}parts/${table}-${String(partIndex).padStart(5, "0")}.json`;
        const position = parts.length;
        const metadata = { table, partIndex, rowStart, rowCount: rows.length };
        parts.push({ ...metadata, objectKey, byteSize: body.byteLength, checksum: "" });
        dataByteSize += body.byteLength;
        await uploads.add(body.byteLength, async () => {
          const receipt = await storage.put(objectKey, body);
          await readAndVerifyBackupObject(storage, receipt);
          parts[position] = { ...receipt, ...metadata };
        });
      });
      counts[table] = scanned.rowCount;
    }

    await uploads.drain();
    let observedPart = 0;
    for (const table of tables) {
      const rescanned = await scanStableTable(table, async (rows, partIndex, rowStart) => {
        const expected = parts[observedPart];
        const body = textEncoder.encode(JSON.stringify(rows));
        const actualChecksum = await checksum(textDecoder.decode(body));
        if (
          !expected
          || expected.table !== table
          || expected.partIndex !== partIndex
          || expected.rowStart !== rowStart
          || expected.rowCount !== rows.length
          || expected.byteSize !== body.byteLength
          || expected.checksum !== actualChecksum
        ) throw new Error("백업 생성 중 원본 데이터가 변경되어 완료하지 않았습니다.");
        observedPart += 1;
      });
      if (rescanned.rowCount !== counts[table]) {
        throw new Error("백업 생성 중 원본 데이터 건수가 변경되어 완료하지 않았습니다.");
      }
    }
    if (observedPart !== parts.length) throw new Error("백업 생성 중 원본 파트 구성이 변경되었습니다.");

    const metadata: ExternalManifestMetadata = {
      backupVersion: EXTERNAL_BACKUP_VERSION,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      type,
      source,
      generatedAt,
      includedData: tables,
      counts,
      storageFormat: EXTERNAL_BACKUP_FORMAT,
    };
    const manifest = await createManifest(metadata, parts);
    const manifestBody = textEncoder.encode(JSON.stringify(manifest));
    const manifestReceipt = await storage.put(manifestKey, manifestBody);
    await readAndVerifyBackupObject(storage, manifestReceipt);
    await validateExternalManifest(manifest);
    const descriptor: ExternalDescriptor = {
      kind: "external",
      format: EXTERNAL_BACKUP_FORMAT,
      objectPrefix,
      manifest: manifestReceipt,
    };
    const byteSize = dataByteSize + manifestReceipt.byteSize;
    const published = await execute(`
      UPDATE backup_snapshots
      SET status = 'completed', counts = ?, checksum = ?, payload = ?,
          byte_size = ?, error_message = ''
      WHERE id = ? AND status = 'creating'
    `, [JSON.stringify(counts), manifest.metadata.checksum, JSON.stringify(descriptor), byteSize, id]);
    if (Number(published.meta.changes ?? 0) !== 1) {
      throw new Error("외부 백업 완료 상태를 원자적으로 게시하지 못했습니다.");
    }
    return {
      id,
      type,
      source,
      storageMode: "external" as const,
      counts,
      checksum: manifest.metadata.checksum,
      byteSize,
      partCount: parts.length,
      maxBufferedBytes,
      maxPendingUploadBytes: uploads.peakBytes,
      createdAt: generatedAt,
    };
  } catch (error) {
    // Finish already-started uploads before deleting their prefix.
    await uploads.settled();
    await removePrefix(storage, objectPrefix).catch(() => undefined);
    await execute(`
      UPDATE backup_snapshots SET status = 'failed', error_message = ? WHERE id = ?
    `, [compactText(errorMessage(error), 500), id]).catch(() => undefined);
    throw error;
  }
}

export async function readExternalBackup(snapshotId: string): Promise<ExternalBackupSnapshot | null> {
  const snapshot = await firstRow<{
    id: string;
    payload: string;
    status: string;
    backup_type: string;
    created_at: string;
    checksum: string;
    schema_version: string;
    app_version: string;
    included_data: string;
    counts: string;
    byte_size: number;
  }>(`
    SELECT id, payload, status, backup_type, created_at, checksum,
           schema_version, app_version, included_data, counts, byte_size
    FROM backup_snapshots WHERE id = ?
  `, [snapshotId]);
  if (!snapshot || snapshot.status !== "completed") throw new Error("완료된 백업을 찾을 수 없습니다.");
  const descriptor = parseDescriptor(snapshot.payload);
  if (!descriptor) return null;
  if (
    descriptor.objectPrefix !== `backups/${snapshotId}/`
    || !scopedManifestKey(descriptor.objectPrefix, descriptor.manifest.objectKey)
  ) throw new Error("외부 백업 객체 범위가 snapshot ID와 일치하지 않습니다.");
  const storage = backupStorageForMode("external");
  if (!storage) throw new Error("외부 백업 저장소가 없습니다.");
  const manifestBody = await readAndVerifyBackupObject(storage, descriptor.manifest);
  const manifest = await validateExternalManifest(JSON.parse(textDecoder.decode(manifestBody)));
  const objectByteSize = descriptor.manifest.byteSize
    + manifest.parts.reduce((total, part) => total + part.byteSize, 0);
  if (
    manifest.metadata.checksum !== snapshot.checksum
    || manifest.metadata.schemaVersion !== snapshot.schema_version
    || manifest.metadata.appVersion !== snapshot.app_version
    || JSON.stringify(manifest.metadata.includedData) !== snapshot.included_data
    || JSON.stringify(manifest.metadata.counts) !== snapshot.counts
    || objectByteSize !== Number(snapshot.byte_size)
  ) {
    throw new Error("외부 백업 설명자와 매니페스트가 일치하지 않습니다.");
  }
  for (const part of manifest.parts) {
    if (!part.objectKey.startsWith(descriptor.objectPrefix)) {
      throw new Error("외부 백업 파트 경로가 백업 전용 범위를 벗어났습니다.");
    }
  }
  return { ...snapshot, descriptor, manifest, storage };
}

function downloadMetadata(manifest: ExternalBackupManifest) {
  return {
    ...manifest.metadata,
    parts: manifest.parts.map(publicPart),
  };
}

async function* externalBackupDownloadChunks(source: ExternalBackupSnapshot) {
  yield textEncoder.encode(`{"metadata":${JSON.stringify(downloadMetadata(source.manifest))},"data":{`);
  let tableSeparator = "";
  for (const table of source.manifest.metadata.includedData) {
    yield textEncoder.encode(`${tableSeparator}${JSON.stringify(table)}:[`);
    tableSeparator = ",";
    let rowSeparator = "";
    for (const part of source.manifest.parts.filter((candidate) => candidate.table === table)) {
      const body = await readAndVerifyBackupObject(source.storage, part, BACKUP_PART_MAX_BYTES);
      const rows = parsePortablePartRows(part.table, body, part.rowCount, source.manifest.metadata.schemaVersion);
      if (rows.length) {
        if (rowSeparator) yield textEncoder.encode(rowSeparator);
        yield body.subarray(1, body.byteLength - 1);
        rowSeparator = ",";
      }
    }
    yield textEncoder.encode("]");
  }
  yield textEncoder.encode("}}");
}

export function externalBackupDownloadStream(source: ExternalBackupSnapshot) {
  const chunks = externalBackupDownloadChunks(source);
  let canceled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await chunks.next();
        if (canceled) return;
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (error) {
        if (!canceled) controller.error(error);
      }
    },
    async cancel() {
      canceled = true;
      await chunks.return();
    },
  }, { highWaterMark: 0 });
}

export async function validatePortableExternalEnvelope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("외부 백업 파일 형식이 유효하지 않습니다.");
  }
  const envelope = value as {
    metadata?: ExternalManifestMetadata & {
      checksum?: string;
      parts?: Array<Omit<ExternalPart, "objectKey">>;
    };
    data?: Record<string, D1Row[]>;
  };
  if (!envelope.metadata || !envelope.data || !Array.isArray(envelope.metadata.parts)) {
    throw new Error("외부 백업 메타데이터 또는 데이터가 없습니다.");
  }
  const { checksum: expectedChecksum, parts, ...metadata } = envelope.metadata;
  const manifestParts = parts.map((part) => ({ ...part, objectKey: "portable" }));
  await validateExternalManifest({
    format: EXTERNAL_BACKUP_FORMAT,
    metadata: { ...metadata, checksum: expectedChecksum ?? "" },
    parts: manifestParts,
  });
  const tableKeys = Object.keys(envelope.data);
  if (JSON.stringify(tableKeys) !== JSON.stringify(metadata.includedData)) {
    throw new Error("외부 백업 데이터 테이블이 매니페스트와 일치하지 않습니다.");
  }
  for (const table of metadata.includedData) {
    const rows = envelope.data[table];
    if (!Array.isArray(rows) || rows.length !== Number(metadata.counts[table])) {
      throw new Error(`${table} 외부 백업 데이터 건수가 일치하지 않습니다.`);
    }
    for (const row of rows) validateRowShape(table, row, metadata.schemaVersion);
  }
  for (const part of parts) {
    const rows = envelope.data[part.table]?.slice(part.rowStart, part.rowStart + part.rowCount) ?? [];
    const body = textEncoder.encode(JSON.stringify(rows));
    if (body.byteLength !== part.byteSize || await checksum(textDecoder.decode(body)) !== part.checksum) {
      throw new Error(`${part.table} 외부 백업 파트 무결성 검증값이 일치하지 않습니다.`);
    }
  }
  return envelope;
}

function keyCountStatement(table: string, rows: D1Row[]) {
  const keys = primaryKeys(table);
  const keyRows = rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])));
  const existingKeys = keys.map((key) => `existing.${quoted(key)}`).join(", ");
  const incomingKeys = keys.map((key) => `json_extract(incoming.value, '$.${key}')`).join(", ");
  return {
    sql: `SELECT COUNT(*) AS count FROM ${quoted(table)} existing WHERE (${existingKeys}) IN (
      SELECT ${incomingKeys} FROM json_each(?) incoming
    )`,
    values: [JSON.stringify(keyRows)],
  };
}

export async function externalBackupConflicts(source: ExternalBackupSnapshot) {
  const details: Record<string, { incoming: number; existingIds: number }> = {};
  for (const table of source.manifest.metadata.includedData.filter(table => RESTORABLE_TABLES[table])) {
    details[table] = { incoming: Number(source.manifest.metadata.counts[table] ?? 0), existingIds: 0 };
  }
  for (const part of source.manifest.parts) {
    const rows = await readPartRows(source, part);
    if (!RESTORABLE_TABLES[part.table]) continue;
    const statement = keyCountStatement(part.table, rows);
    const existing = await firstRow<{ count: number }>(statement.sql, statement.values);
    details[part.table].existingIds += Number(existing?.count ?? 0);
  }
  return details;
}

export function externalReplacementReadiness(source: ExternalBackupSnapshot) {
  const requiredTables = allowedBackupTables(source.manifest.metadata.type, false, SCHEMA_VERSION)
    .filter((table) => RESTORABLE_TABLES[table]
      && (table !== "guest_import_receipts" || source.manifest.metadata.schemaVersion === SCHEMA_VERSION));
  const included = new Set(source.manifest.metadata.includedData);
  const missingTables = requiredTables.filter((table) => !included.has(table));
  return { ready: missingTables.length === 0, requiredTables, missingTables };
}

function stagingRestoreStatement(table: string, stagingId: string) {
  const spec = RESTORABLE_TABLES[table];
  const keys = primaryKeys(table);
  const columns = spec.columns.map(quoted).join(", ");
  const extracted = spec.columns.map((column) => `json_extract(row.value, '$.${column}')`).join(", ");
  const updates = spec.columns.filter((column) => !keys.includes(column))
    .map((column) => `${quoted(column)} = excluded.${quoted(column)}`).join(", ");
  return {
    sql: `
      INSERT INTO ${quoted(table)} (${columns})
      SELECT ${extracted}
      FROM backup_chunks chunk, json_each(chunk.payload, '$.rows') row
      WHERE chunk.snapshot_id = ? AND json_extract(chunk.payload, '$.table') = ?
      ON CONFLICT(${keys.map(quoted).join(", ")}) ${IMMUTABLE_PERSONAL_TABLES.has(table) ? immutablePersonalConflictAction(table) : `DO UPDATE SET ${updates}`}
    `,
    values: [stagingId, table],
  } satisfies SqlCommand;
}

async function verifyAllParts(source: ExternalBackupSnapshot) {
  let count = 0;
  for (const part of source.manifest.parts) {
    await readPartRows(source, part);
    count += 1;
  }
  return count;
}

async function stageAllParts(source: ExternalBackupSnapshot, stagingId: string, fullReplace: boolean, allowed: string[]) {
  let chunkIndex = 0;
  let processedParts = 0;
  let statements: SqlCommand[] = [];
  const immutableRows: Record<string, D1Row[]> = {};
  for (const part of source.manifest.parts) {
    const sourceRows = await readPartRows(source, part);
    processedParts += 1;
    if (allowed.includes(part.table) && IMMUTABLE_PERSONAL_TABLES.has(part.table))
      immutableRows[part.table] = [...(immutableRows[part.table] ?? []), ...sourceRows];
    if (!RESTORABLE_TABLES[part.table]) continue;
    const rows = restoredContentRows(
      part.table, sourceRows,
      allowed.includes("content_releases") && Number(source.manifest.metadata.counts.content_releases ?? 0) > 0,
      source.manifest.metadata.type, source.manifest.metadata.schemaVersion,
    );
    statements.push({
      sql: "INSERT INTO backup_chunks (snapshot_id, chunk_index, payload) VALUES (?, ?, ?)",
      values: [stagingId, chunkIndex, JSON.stringify({ table: part.table, rows })],
    });
    chunkIndex += 1;
    if (statements.length === 20) {
      await adminRepository.batch(statements);
      statements = [];
    }
  }
  if (statements.length) await adminRepository.batch(statements);
  for (const table of IMMUTABLE_PERSONAL_TABLES) {
    if (allowed.includes(table) && !immutableRows[table]) immutableRows[table] = [];
  }
  await verifyImmutablePersonalRows(immutableRows, fullReplace);
  return processedParts;
}

async function stagingExistingIds(stagingId: string, table: string) {
  const keys = primaryKeys(table);
  const match = keys.map((key) => `existing.${quoted(key)} = json_extract(row.value, '$.${key}')`).join(" AND ");
  const result = await firstRow<{ count: number }>(`
    SELECT COUNT(*) AS count
    FROM backup_chunks chunk, json_each(chunk.payload, '$.rows') row
    WHERE chunk.snapshot_id = ?
      AND json_extract(chunk.payload, '$.table') = ?
      AND EXISTS (SELECT 1 FROM ${quoted(table)} existing WHERE ${match})
  `, [stagingId, table]);
  return Number(result?.count ?? 0);
}

export async function restoreExternalBackup(
  identity: AdminIdentity,
  source: ExternalBackupSnapshot,
  mode: "merge" | "full-replace" | "content-only" | "settings-only",
  confirmation: unknown,
  createSafetyBackup: () => Promise<{ id: string }>,
) {
  if (mode === "full-replace" && confirmation !== "전체 데이터를 복원합니다") {
    throw new Error("전체 교체 확인 문구가 일치하지 않습니다.");
  }
  let allowed = source.manifest.metadata.includedData.filter((table) => RESTORABLE_TABLES[table]);
  if (mode === "content-only") {
    allowed = allowed.filter((table) => ["questions", "theories", "sw_questions", "sw_theories", "content_releases"].includes(table));
  }
  if (mode === "settings-only") allowed = allowed.filter((table) => table === "site_settings");
  if (!allowed.length) throw new Error("선택한 복원 방식에 적용할 데이터가 없습니다.");
  let replacementScope = allowed;
  if (mode === "full-replace") {
    const readiness = externalReplacementReadiness(source);
    if (!readiness.ready) {
      throw new Error(`전체 교체에 필요한 백업 테이블이 누락되었습니다: ${readiness.missingTables.join(", ")}`);
    }
    replacementScope = [...new Set([...readiness.requiredTables, ...allowed])];
  }

  const leaseOwner = `restore:${crypto.randomUUID()}`;
  if (!await claimRestoreLease(leaseOwner)) throw new Error("다른 백업 복원 작업이 진행 중입니다.");
  const stagingId = `restore-stage-${crypto.randomUUID()}`;
  try {
    const validatedParts = await verifyAllParts(source);
    await execute(`
      INSERT INTO backup_snapshots (
        id, backup_type, status, schema_version, app_version, included_data,
        counts, checksum, payload, byte_size, created_by_hash, created_at, error_message
      ) VALUES (?, 'restore-stage', 'creating', ?, ?, ?, ?, ?, ?, 0, ?, ?, '')
    `, [
      stagingId,
      SCHEMA_VERSION,
      APP_VERSION,
      JSON.stringify(allowed),
      JSON.stringify(source.manifest.metadata.counts),
      source.manifest.metadata.checksum,
      JSON.stringify({ kind: "restore-staging", sourceBackupId: source.id }),
      identity.hash,
      now(),
    ]);
    const processedParts = await stageAllParts(source, stagingId, mode === "full-replace", allowed);
    if (processedParts !== validatedParts) throw new Error("복원 처리 파트 수가 검증 결과와 다릅니다.");

    const safetyBackup = await createSafetyBackup();
    const statements: SqlCommand[] = [];
    if (mode === "full-replace") {
      for (const table of BACKUP_DELETE_ORDER) {
        if (replacementScope.includes(table) && !IMMUTABLE_PERSONAL_TABLES.has(table))
          statements.push({ sql: `DELETE FROM ${quoted(table)}` });
      }
    }
    for (const table of BACKUP_INSERT_ORDER) {
      if (allowed.includes(table)) statements.push(stagingRestoreStatement(table, stagingId));
    }
    if (mode === "full-replace") {
      for (const table of IMMUTABLE_PERSONAL_TABLES) {
        if (allowed.includes(table)) statements.push({
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM ${quoted(table)}) = ? THEN 1 ELSE abs(-9223372036854775808) END AS restored_count`,
          values: [Number(source.manifest.metadata.counts[table] ?? 0)],
        });
      }
    }
    if (allowed.includes("study_groups")) statements.push(...GROUP_OWNER_SLOT_RECOVERY_SQL.map(sql => ({sql})));
    if (!statements.length) throw new Error("복원할 데이터가 없습니다.");
    await adminRepository.batch(statements);

    const verification: Record<string, number> = {};
    for (const table of mode === "full-replace" ? replacementScope : allowed) {
      const revisionFilter = table === "site_settings" ? `
        WHERE key != 'content_cache_revision' OR EXISTS (
          SELECT 1 FROM backup_chunks chunk, json_each(chunk.payload, '$.rows') item
          WHERE chunk.snapshot_id = ? AND json_extract(chunk.payload, '$.table') = 'site_settings'
            AND json_extract(item.value, '$.key') = 'content_cache_revision'
        )` : "";
      const row = await firstRow<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${quoted(table)} ${revisionFilter}`,
        table === "site_settings" ? [stagingId] : [],
      );
      verification[table] = Number(row?.count ?? 0);
      if (mode === "full-replace" && verification[table] !== Number(source.manifest.metadata.counts[table] ?? 0)) {
        throw new Error(`${table} 복원 검증 건수가 일치하지 않습니다.`);
      }
    }
    for (const table of allowed) {
      if (await stagingExistingIds(stagingId, table) !== Number(source.manifest.metadata.counts[table] ?? 0)) {
        throw new Error(`${table} 복원 후 기본 키 검증에 실패했습니다.`);
      }
    }
    await execute("DELETE FROM backup_chunks WHERE snapshot_id = ?", [stagingId]);
    await execute("DELETE FROM backup_snapshots WHERE id = ?", [stagingId]);
    await completeRestoreLease(leaseOwner);
    return {
      mode,
      storageMode: "external",
      safetyBackupId: safetyBackup.id,
      restoredTables: allowed,
      verification,
      validatedParts,
    };
  } catch (error) {
    await execute("DELETE FROM backup_chunks WHERE snapshot_id = ?", [stagingId]).catch(() => undefined);
    await execute("DELETE FROM backup_snapshots WHERE id = ?", [stagingId]).catch(() => undefined);
    await failRestoreLease(leaseOwner, errorMessage(error)).catch(() => undefined);
    throw error;
  }
}

export async function deleteExternalBackupObjects(snapshotId: string) {
  // Deletion must work for failed uploads and missing/corrupt manifests too.
  // Only load the small storage descriptor, never an inline D1 backup payload.
  const source = await firstRow<{ external_payload: string | null }>(`
    SELECT CASE WHEN json_valid(payload) THEN
      CASE WHEN json_extract(payload, '$.kind') IN ('external', 'external-progress') THEN payload END
    END AS external_payload
    FROM backup_snapshots WHERE id = ?
  `, [snapshotId]);
  if (!source) throw new Error("삭제할 백업을 찾을 수 없습니다.");
  if (source.external_payload === null) return false;
  const progress = JSON.parse(source.external_payload) as { kind?: string; objectPrefix?: string };
  if (progress.kind === "external-progress") {
    if (progress.objectPrefix !== `backups/${snapshotId}/`) {
      throw new Error("외부 백업 객체 삭제 범위가 snapshot ID와 일치하지 않습니다.");
    }
    const storage = backupStorageForMode("external");
    if (!storage) throw new Error("외부 백업 저장소가 없습니다.");
    await removePrefix(storage, progress.objectPrefix);
    return true;
  }
  const descriptor = parseDescriptor(source.external_payload);
  if (!descriptor || descriptor.objectPrefix !== `backups/${snapshotId}/`
    || !scopedManifestKey(descriptor.objectPrefix, descriptor.manifest.objectKey)) {
    throw new Error("외부 백업 객체 삭제 범위가 snapshot ID와 일치하지 않습니다.");
  }
  const storage = backupStorageForMode("external");
  if (!storage) throw new Error("외부 백업 저장소가 없습니다.");
  await removePrefix(storage, descriptor.objectPrefix);
  return true;
}
