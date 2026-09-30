import { GROUP_OWNER_SLOT_RECOVERY_SQL } from "@shared/admin/group-owner-slot-recovery.mjs";
import { createHash } from "node:crypto";
import { backupTableSpec, supportedBackupSchema } from "@shared/admin/backup-contract.mjs";
import { IMMUTABLE_PERSONAL_TABLES, immutablePersonalConflictAction, immutablePersonalCountGuards, verifyImmutablePersonalRows } from "./admin-backup-personal-immutability";
import {
  APP_VERSION,
  type AdminIdentity,
  BACKUP_DELETE_ORDER,
  BACKUP_INSERT_ORDER,
  BACKUP_TABLES,
  BACKUP_VERSION,
  type D1Row,
  type JsonRecord,
  RESTORABLE_TABLES,
  SCHEMA_VERSION,
  type SqlCommand,
  adminRepository,
  allRows,
  allowedBackupTables,
  boundedInteger,
  claimBackupCreationLease,
  claimAutomaticBackupLease,
  compactText,
  completeBackupCreationLease,
  completeAutomaticBackupLease,
  errorMessage,
  execute,
  expireStalledBackups,
  failBackupCreationLease,
  failAutomaticBackupLease,
  firstRow,
  now,
  settingValue,
  splitBackupPayload,
} from "./admin-use-case-runtime";
import { restoredContentRows } from "./admin-backup-restore-content";
import { AUTOMATIC_BACKUP_MIN_INTERVAL_MS } from "@shared/admin/backup-schedule.mjs";
import { canDeleteBackup } from "@shared/admin/backup-deletion";
import {
  createExternalBackup,
  deleteExternalBackupObjects,
  externalBackupConflicts,
  externalBackupDownloadStream,
  externalReplacementReadiness,
  readExternalBackup,
  restoreExternalBackup,
  validatePortableExternalEnvelope,
} from "./admin-external-backup-use-cases";
import {
  type BackupStorageMode,
  EXTERNAL_BACKUP_VERSION,
  configuredBackupStorageMode,
} from "./backup-storage";

export type BackupType = keyof typeof BACKUP_TABLES;
export type BackupEnvelope = {
  metadata: {
    backupVersion: string;
    appVersion: string;
    schemaVersion: string;
    type: BackupType;
    source: "manual" | "automatic" | "pre-restore";
    generatedAt: string;
    includedData: string[];
    counts: Record<string, number>;
    replaceMissingTables?: string[];
    replaceMissingTheoryScope?: { category: string; examScope: string };
    theoryIdRemap?: Array<{ sourceId: number; canonicalId: number }>;
    replacementScope?: { category: string; examScope: string };
    replacementCourseScope?: {
      questionExamScope: string;
      theoryExamScopes: string[];
      categories: string[];
    };
    removedQuestionIds?: number[];
    discardWithoutBackup?: boolean;
    checksum: string;
  };
  data: Record<string, D1Row[]>;
};

export async function backupDigestBase(
  metadata: Omit<BackupEnvelope["metadata"], "checksum">,
  data: BackupEnvelope["data"],
) {
  // Preserve the original JSON checksum byte-for-byte without allocating a
  // second full backup string and UTF-8 buffer beside the parsed document.
  const digest = createHash("sha256");
  digest.update('{"metadata":').update(JSON.stringify(metadata)).update(',"data":{');
  let tableSeparator = "";
  for (const [table, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) throw new Error(`${table} 백업 데이터 목록이 유효하지 않습니다.`);
    digest.update(tableSeparator).update(JSON.stringify(table)).update(":[");
    let rowSeparator = "";
    for (const row of rows) {
      digest.update(rowSeparator).update(JSON.stringify(row) ?? "null");
      rowSeparator = ",";
    }
    digest.update("]");
    tableSeparator = ",";
  }
  return digest.update("}}").digest("hex");
}

export async function createBackup(
  identity: AdminIdentity,
  type: BackupType,
  options: {
    includeAnalytics?: boolean;
    source?: BackupEnvelope["metadata"]["source"];
    storageMode?: BackupStorageMode;
  } = {},
) {
  const leaseOwner = `backup-create:${crypto.randomUUID()}`;
  await expireStalledBackups();
  if (!await claimBackupCreationLease(leaseOwner)) {
    throw new Error("다른 백업 생성 작업이 진행 중입니다.");
  }
  let result: Awaited<ReturnType<typeof createBackupWithLease>>;
  try {
    result = await createBackupWithLease(identity, type, options);
  } catch (error) {
    await failBackupCreationLease(leaseOwner, errorMessage(error)).catch(() => undefined);
    throw error;
  }
  // A successfully published snapshot must not turn into a UI failure solely
  // because its maintenance lease cleanup failed. The lease expires safely.
  await completeBackupCreationLease(leaseOwner).catch(() => undefined);
  return result;
}

async function createBackupWithLease(
  identity: AdminIdentity,
  type: BackupType,
  options: {
    includeAnalytics?: boolean;
    source?: BackupEnvelope["metadata"]["source"];
    storageMode?: BackupStorageMode;
  },
) {
  const storageMode = options.storageMode ?? configuredBackupStorageMode();
  if (storageMode === "external") {
    return createExternalBackup(identity, type, options);
  }
  const source = options.source ?? "manual";
  const tables = allowedBackupTables(type, options.includeAnalytics);
  const id = crypto.randomUUID();
  const generatedAt = now();
  const backupType = source === "automatic"
    ? `auto-${type}`
    : source === "pre-restore"
      ? `pre-restore-${type}`
      : type;
  await execute(`
    INSERT INTO backup_snapshots (
      id, backup_type, status, schema_version, app_version, included_data,
      counts, checksum, payload, byte_size, created_by_hash, created_at,
      error_message
    ) VALUES (?, ?, 'creating', ?, ?, ?, '{}', '', '{}', 0, ?, ?, '')
  `, [
    id,
    backupType,
    SCHEMA_VERSION,
    APP_VERSION,
    JSON.stringify(tables),
    identity.hash,
    generatedAt,
  ]);

  try {
    const data: BackupEnvelope["data"] = {};
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const rows = await allRows(`SELECT * FROM ${table}`);
      data[table] = rows;
      counts[table] = rows.length;
    }
    const metadataWithoutChecksum = {
      backupVersion: BACKUP_VERSION,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      type,
      source,
      storageMode: "database" as const,
      generatedAt,
      includedData: tables,
      counts,
    };
    const digest = await backupDigestBase(metadataWithoutChecksum, data);
    const envelope: BackupEnvelope = {
      metadata: { ...metadataWithoutChecksum, checksum: digest },
      data,
    };
    const serialized = JSON.stringify(envelope);
    const byteSize = new TextEncoder().encode(serialized).byteLength;
    await writeBackupPayload(id, serialized);
    await execute(`
      UPDATE backup_snapshots
      SET status = 'completed', counts = ?, checksum = ?, payload = ?,
          byte_size = ?, error_message = ''
      WHERE id = ?
    `, [JSON.stringify(counts), digest, "@chunked", byteSize, id]);

    const retention = boundedInteger(
      await settingValue("backup_retention_count", "10"),
      2,
      50,
      10,
    );
    await execute(`
      DELETE FROM backup_snapshots
      WHERE id IN (
        SELECT id FROM backup_snapshots
        WHERE status = 'completed'
          AND backup_type NOT LIKE 'pre-restore-%'
          AND payload NOT LIKE '{"kind":"external"%'
          AND id != (
            SELECT id FROM backup_snapshots
            WHERE status = 'completed'
            ORDER BY created_at DESC LIMIT 1
          )
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ?
      )
    `, [Math.max(1, retention - 1)]);
    await execute(`
      DELETE FROM backup_chunks
      WHERE snapshot_id NOT IN (SELECT id FROM backup_snapshots)
    `);

    return {
      id,
      type,
      source,
      counts,
      checksum: digest,
      byteSize,
      createdAt: generatedAt,
    };
  } catch (error) {
    await execute(
      "DELETE FROM backup_chunks WHERE snapshot_id = ?",
      [id],
    ).catch(() => undefined);
    await execute(`
      UPDATE backup_snapshots
      SET status = 'failed', error_message = ?
      WHERE id = ?
    `, [compactText(errorMessage(error), 500), id]).catch(() => undefined);
    throw error;
  }
}

export async function writeBackupPayload(snapshotId: string, value: string) {
  await execute("DELETE FROM backup_chunks WHERE snapshot_id = ?", [snapshotId]);
  const chunks = splitBackupPayload(value);
  for (let start = 0; start < chunks.length; start += 20) {
    const statements: SqlCommand[] = chunks.slice(start, start + 20).map((payload, offset) => ({
      sql: `
        INSERT INTO backup_chunks (snapshot_id, chunk_index, payload)
        VALUES (?, ?, ?)
      `,
      values: [snapshotId, start + offset, payload],
    }));
    await adminRepository.batch(statements);
  }
}

export async function readBackupPayload(snapshotId: string) {
  const snapshot = await firstRow<{
    payload: string;
    status: string;
    backup_type: string;
    created_at: string;
  }>(`
    SELECT payload, status, backup_type, created_at
    FROM backup_snapshots
    WHERE id = ?
  `, [snapshotId]);
  if (!snapshot || snapshot.status !== "completed") {
    throw new Error("완료된 백업을 찾을 수 없습니다.");
  }
  if (snapshot.payload !== "@chunked") {
    return { ...snapshot, serialized: snapshot.payload };
  }
  const chunks = await allRows<{ payload: string }>(`
    SELECT payload
    FROM backup_chunks
    WHERE snapshot_id = ?
    ORDER BY chunk_index
  `, [snapshotId]);
  if (!chunks.length) throw new Error("백업 본문 청크가 없습니다.");
  return {
    ...snapshot,
    serialized: chunks.map((chunk) => String(chunk.payload)).join(""),
  };
}

export async function openBackupDownload(snapshotId: string) {
  const external = await readExternalBackup(snapshotId);
  if (external) {
    return {
      backup_type: external.backup_type,
      created_at: external.created_at,
      body: externalBackupDownloadStream(external) as BodyInit,
      storageMode: "external" as const,
    };
  }
  const legacy = await readBackupPayload(snapshotId);
  return {
    backup_type: legacy.backup_type,
    created_at: legacy.created_at,
    body: legacy.serialized as BodyInit,
    storageMode: "database" as const,
  };
}

export async function maybeCreateAutomaticBackup(identity: AdminIdentity) {
  if (await settingValue("auto_backup_enabled", "false") !== "true") return;
  const leaseOwner = `auto-backup:${crypto.randomUUID()}`;
  if (!await claimAutomaticBackupLease(leaseOwner)) return;
  try {
    const last = await firstRow<{ created_at: string }>(`
      SELECT created_at FROM backup_snapshots
      WHERE backup_type = 'auto-full' AND status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    `);
    if (last && Date.now() - new Date(last.created_at).getTime() < AUTOMATIC_BACKUP_MIN_INTERVAL_MS) {
      await completeAutomaticBackupLease(leaseOwner);
      return;
    }
    const backup = await createBackup(identity, "full", { source: "automatic" });
    await completeAutomaticBackupLease(leaseOwner);
    return backup;
  } catch (error) {
    await failAutomaticBackupLease(leaseOwner, errorMessage(error)).catch(() => undefined);
    throw error;
  }
}


export async function validateBackupEnvelope(value: unknown): Promise<BackupEnvelope> {
  if (!value || typeof value !== "object") throw new Error("백업 파일 형식이 유효하지 않습니다.");
  const envelope = value as Partial<BackupEnvelope>;
  if (!envelope.metadata || !envelope.data || typeof envelope.data !== "object") {
    throw new Error("백업 메타데이터 또는 데이터가 없습니다.");
  }
  if (envelope.metadata.backupVersion !== BACKUP_VERSION) {
    if (envelope.metadata.backupVersion === EXTERNAL_BACKUP_VERSION) {
      return await validatePortableExternalEnvelope(value) as BackupEnvelope;
    }
    throw new Error(`지원하지 않는 백업 버전입니다. 현재 지원 버전: ${BACKUP_VERSION}`);
  }
  if (!supportedBackupSchema(envelope.metadata.schemaVersion)) {
    throw new Error(`스키마 버전이 다릅니다. 현재 지원 버전: ${SCHEMA_VERSION}`);
  }
  if (!Object.hasOwn(BACKUP_TABLES, envelope.metadata.type)) {
    throw new Error("백업 유형이 유효하지 않습니다.");
  }
  const { checksum: expected, ...withoutChecksum } = envelope.metadata;
  const actual = await backupDigestBase(
    withoutChecksum as Omit<BackupEnvelope["metadata"], "checksum">,
    envelope.data,
  );
  if (!expected || expected !== actual) {
    throw new Error("백업 무결성 검증값이 일치하지 않습니다.");
  }
  const includedData = envelope.metadata.includedData;
  if (!Array.isArray(includedData) || new Set(includedData).size !== includedData.length) {
    throw new Error("백업 데이터 범위가 유효하지 않습니다.");
  }
  const permitted = new Set(allowedBackupTables(
    envelope.metadata.type,
    envelope.metadata.type === "full",
    envelope.metadata.schemaVersion,
  ));
  for (const table of includedData) {
    const rows = envelope.data[table];
    if (!permitted.has(table) || !backupTableSpec(table, envelope.metadata.schemaVersion)) {
      throw new Error(`${table} 데이터는 해당 백업 유형에 포함할 수 없습니다.`);
    }
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error(`${table} 데이터 목록이 유효하지 않습니다.`);
    }
    if (Number(envelope.metadata.counts?.[table]) !== rows.length) {
      throw new Error(`${table} 백업 건수가 실제 데이터와 일치하지 않습니다.`);
    }
  }
  const replaceMissingTables = envelope.metadata.replaceMissingTables ?? [];
  if (
    !Array.isArray(replaceMissingTables)
    || new Set(replaceMissingTables).size !== replaceMissingTables.length
    || replaceMissingTables.some((table) => table !== "theories" || !includedData.includes(table))
  ) {
    throw new Error("교체 삭제 범위가 유효하지 않습니다.");
  }
  const theoryScope = envelope.metadata.replaceMissingTheoryScope;
  if (theoryScope !== undefined && (
    !theoryScope || typeof theoryScope !== "object" || Array.isArray(theoryScope)
    || !replaceMissingTables.includes("theories")
    || typeof theoryScope.category !== "string" || !theoryScope.category.trim()
    || typeof theoryScope.examScope !== "string" || !theoryScope.examScope.trim()
    || (envelope.data.theories ?? []).some((row) => (
      row.category !== theoryScope.category || row.exam_scope !== theoryScope.examScope
    ))
  )) throw new Error("과목별 이론 교체 범위가 입력 이론과 일치하지 않습니다.");
  const theoryIdRemap = envelope.metadata.theoryIdRemap ?? [];
  if (!Array.isArray(theoryIdRemap)) throw new Error("이론 ID 통합표가 유효하지 않습니다.");
  if (replaceMissingTables.includes("theories")) {
    const incomingIds = new Set((envelope.data.theories ?? []).map((row) => Number(row.id)));
    const sourceIds = new Set<number>();
    for (const mapping of theoryIdRemap) {
      if (
        !Number.isInteger(mapping?.sourceId)
        || !Number.isInteger(mapping?.canonicalId)
        || mapping.sourceId === mapping.canonicalId
        || sourceIds.has(mapping.sourceId)
        || incomingIds.has(mapping.sourceId)
        || !incomingIds.has(mapping.canonicalId)
      ) {
        throw new Error("이론 ID 통합표가 삭제·정본 범위와 일치하지 않습니다.");
      }
      sourceIds.add(mapping.sourceId);
    }
    if (!incomingIds.size || !sourceIds.size) {
      throw new Error("이론 교체 삭제에는 전체 정본과 ID 통합표가 필요합니다.");
    }
  } else if (theoryIdRemap.length) {
    throw new Error("이론 ID 통합표에는 theories 교체 삭제 범위가 필요합니다.");
  }
  const replacementScope = envelope.metadata.replacementScope ?? null;
  const removedQuestionIds = envelope.metadata.removedQuestionIds ?? [];
  const incomingQuestionIds = new Set(
    (envelope.data.questions ?? []).map((row) => Number(row.id)),
  );
  if (
    (replacementScope !== null && (
      typeof replacementScope !== "object"
      || typeof replacementScope.category !== "string"
      || !replacementScope.category.trim()
      || typeof replacementScope.examScope !== "string"
      || !replacementScope.examScope.trim()
      || !includedData.includes("questions")
    ))
    || !Array.isArray(removedQuestionIds)
    || new Set(removedQuestionIds).size !== removedQuestionIds.length
    || removedQuestionIds.some((id) => !Number.isInteger(id) || incomingQuestionIds.has(id))
    || (removedQuestionIds.length > 0 && replacementScope === null)
  ) {
    throw new Error("문제 교체 범위가 유효하지 않습니다.");
  }
  const replacementCourseScope = envelope.metadata.replacementCourseScope ?? null;
  const discardWithoutBackup = envelope.metadata.discardWithoutBackup ?? false;
  if (replacementCourseScope !== null) {
    if (
      typeof replacementCourseScope !== "object"
      || typeof replacementCourseScope.questionExamScope !== "string"
      || !replacementCourseScope.questionExamScope.trim()
      || !Array.isArray(replacementCourseScope.theoryExamScopes)
      || replacementCourseScope.theoryExamScopes.length === 0
      || new Set(replacementCourseScope.theoryExamScopes).size !== replacementCourseScope.theoryExamScopes.length
      || replacementCourseScope.theoryExamScopes.some((value) => typeof value !== "string" || !value.trim())
      || !Array.isArray(replacementCourseScope.categories)
      || replacementCourseScope.categories.length === 0
      || new Set(replacementCourseScope.categories).size !== replacementCourseScope.categories.length
      || replacementCourseScope.categories.some((value) => typeof value !== "string" || !value.trim())
      || !includedData.includes("questions")
      || !includedData.includes("theories")
      || replacementScope !== null
      || removedQuestionIds.length > 0
    ) {
      throw new Error("과정 전체 폐기 교체 범위가 유효하지 않습니다.");
    }
    const categories = new Set(replacementCourseScope.categories);
    const theoryScopes = new Set(replacementCourseScope.theoryExamScopes);
    const incomingQuestions = envelope.data.questions ?? [];
    const incomingTheories = envelope.data.theories ?? [];
    if (
      incomingQuestions.length === 0
      || incomingTheories.length === 0
      || incomingQuestions.some((row) => (
        row.exam_scope !== replacementCourseScope.questionExamScope
        || !categories.has(String(row.category))
      ))
      || incomingTheories.some((row) => (
        !theoryScopes.has(String(row.exam_scope))
        || !categories.has(String(row.category))
      ))
    ) {
      throw new Error("과정 전체 폐기 교체 데이터가 승인된 범위를 벗어났습니다.");
    }
  }
  if (typeof discardWithoutBackup !== "boolean" || (discardWithoutBackup && replacementCourseScope === null)) {
    throw new Error("무백업 폐기 교체 설정이 유효하지 않습니다.");
  }
  return envelope as BackupEnvelope;
}

export async function envelopeFromPayload(payload: JsonRecord) {
  if (payload.backupId) {
    const row = await readBackupPayload(String(payload.backupId));
    const envelope: unknown = JSON.parse(row.serialized);
    // A legacy D1 download string is no longer needed after parsing. Keeping
    // it alive across validation can exhaust the Worker memory budget.
    row.serialized = "";
    row.payload = "";
    return validateBackupEnvelope(envelope);
  }
  const candidate = typeof payload.backup === "string"
    ? JSON.parse(payload.backup)
    : payload.backup;
  return validateBackupEnvelope(candidate);
}

export async function previewBackupPayload(payload: JsonRecord) {
  if (payload.backupId) {
    const external = await readExternalBackup(String(payload.backupId));
    if (external) {
      return {
        metadata: external.manifest.metadata,
        conflicts: await externalBackupConflicts(external),
        fullReplace: externalReplacementReadiness(external),
      };
    }
  }
  const envelope = await envelopeFromPayload(payload);
  return {
    metadata: envelope.metadata,
    conflicts: await backupConflicts(envelope),
    fullReplace: backupReplacementReadiness(envelope),
  };
}

export async function restoreBackupPayload(
  identity: AdminIdentity,
  payload: JsonRecord,
  mode: "merge" | "full-replace" | "content-only" | "settings-only",
  confirmation: unknown,
) {
  if (payload.backupId) {
    const external = await readExternalBackup(String(payload.backupId));
    if (external) {
      return restoreExternalBackup(identity, external, mode, confirmation, () => (
        createBackup(identity, "full", { source: "pre-restore", storageMode: "external" })
      ));
    }
  }
  return restoreBackup(identity, await envelopeFromPayload(payload), mode, confirmation);
}

export async function deleteBackupSnapshot(snapshotId: string) {
  const backup = await firstRow<{
    id: string; backup_type: string; status: string; byte_size: number; created_at: string;
  }>(`
    SELECT id, backup_type, status, byte_size, created_at
    FROM backup_snapshots WHERE id = ?
  `, [snapshotId]);
  if (!backup) throw new Error("삭제할 백업을 찾을 수 없습니다.");
  if (!canDeleteBackup(backup)) throw new Error("생성·복원 작업 중인 백업은 삭제할 수 없습니다.");
  // Keep the metadata when object cleanup fails, so an explicit retry can finish it.
  await deleteExternalBackupObjects(snapshotId);
  await adminRepository.batch([
    { sql: "DELETE FROM backup_chunks WHERE snapshot_id = ?", values: [snapshotId] },
    { sql: "DELETE FROM backup_snapshots WHERE id = ?", values: [snapshotId] },
  ]);
  return backup;
}

export function restoreStatement(table: string, rows: D1Row[]) {
  const spec = RESTORABLE_TABLES[table];
  if (!spec) throw new Error(`${table} 데이터는 복원할 수 없습니다.`);
  const primaryKeys = Array.isArray(spec.primaryKey)
    ? spec.primaryKey
    : [spec.primaryKey];
  const columns = spec.columns.map((column) => `\`${column}\``).join(", ");
  const extracted = spec.columns
    .map((column) => `json_extract(value, '$.${column}')`)
    .join(", ");
  const updates = spec.columns
    .filter((column) => !primaryKeys.includes(column))
    .map((column) => `\`${column}\` = excluded.\`${column}\``)
    .join(", ");
  const conflictTarget = primaryKeys.map((column) => `\`${column}\``).join(", ");
  return {
    sql: `
      INSERT INTO \`${table}\` (${columns})
      SELECT ${extracted} FROM json_each(?) WHERE 1
      ON CONFLICT(${conflictTarget}) ${IMMUTABLE_PERSONAL_TABLES.has(table) ? immutablePersonalConflictAction(table) : `DO UPDATE SET ${updates}`}
    `,
    values: [JSON.stringify(rows)],
  } satisfies SqlCommand;
}

export function chunkRestoreRows(rows: D1Row[], maxCharacters = 100_000) {
  const groups: D1Row[][] = [];
  let current: D1Row[] = [];
  let size = 2;
  for (const row of rows) {
    const rowSize = JSON.stringify(row).length + 1;
    if (current.length && size + rowSize > maxCharacters) {
      groups.push(current);
      current = [];
      size = 2;
    }
    current.push(row);
    size += rowSize;
  }
  if (current.length) groups.push(current);
  return groups;
}

export async function backupConflicts(envelope: BackupEnvelope) {
  const details: Record<string, { incoming: number; existingIds: number }> = {};
  for (const table of envelope.metadata.includedData) {
    const spec = RESTORABLE_TABLES[table];
    if (!spec) continue;
    const rows = envelope.data[table] ?? [];
    const primaryKeys = Array.isArray(spec.primaryKey)
      ? spec.primaryKey
      : [spec.primaryKey];
    const incomingKeys = rows.map((row) => Object.fromEntries(
      primaryKeys.map((column) => [column, row[column]]),
    ));
    const keyMatch = primaryKeys
      .map((column) => `existing.\`${column}\` = json_extract(incoming.value, '$.${column}')`)
      .join(" AND ");
    let existingIds = 0;
    for (const group of chunkRestoreRows(incomingKeys)) {
      const existing = await firstRow<{ count: number }>(`
        SELECT COUNT(*) AS count
        FROM (
          SELECT DISTINCT ${primaryKeys.map(column => `existing.\`${column}\``).join(", ")}
          FROM json_each(?) AS incoming
          CROSS JOIN \`${table}\` AS existing
          WHERE ${keyMatch}
        )
      `, [JSON.stringify(group)]);
      existingIds += Number(existing?.count ?? 0);
    }
    details[table] = {
      incoming: rows.length,
      existingIds,
    };
  }
  return details;
}

export function backupReplacementReadiness(envelope: BackupEnvelope) {
  const requiredTables = allowedBackupTables(envelope.metadata.type, false, SCHEMA_VERSION)
    .filter((table) => RESTORABLE_TABLES[table]
      && (table !== "guest_import_receipts" || envelope.metadata.schemaVersion === SCHEMA_VERSION));
  const included = new Set(envelope.metadata.includedData);
  const missingTables = requiredTables.filter((table) => !included.has(table));
  return {
    ready: missingTables.length === 0,
    requiredTables,
    missingTables,
  };
}

export async function restoreBackup(
  identity: AdminIdentity,
  envelope: BackupEnvelope,
  mode: "merge" | "full-replace" | "content-only" | "settings-only",
  confirmation: unknown,
  options: { skipSafetyBackup?: boolean } = {},
) {
  if (mode === "full-replace" && confirmation !== "전체 데이터를 복원합니다") {
    throw new Error("전체 교체 확인 문구가 일치하지 않습니다.");
  }
  let allowed = envelope.metadata.includedData.filter((table) => RESTORABLE_TABLES[table]);
  if (mode === "content-only") {
    allowed = allowed.filter((table) => [
      "questions", "theories", "sw_questions", "sw_theories", "content_releases",
    ].includes(table));
  }
  if (mode === "settings-only") allowed = allowed.filter((table) => table === "site_settings");
  if (!allowed.length) throw new Error("선택한 복원 방식에 적용할 데이터가 없습니다.");
  let fullReplacementScope = allowed;
  if (mode === "full-replace") {
    const readiness = backupReplacementReadiness(envelope);
    if (!readiness.ready) {
      throw new Error(`전체 교체에 필요한 백업 테이블이 누락되었습니다: ${readiness.missingTables.join(", ")}`);
    }
    fullReplacementScope = [...new Set([
      ...readiness.requiredTables,
      ...allowed,
    ])].filter((table) => RESTORABLE_TABLES[table]);
  }
  const safetyBackup = options.skipSafetyBackup
    ? null
    : await createBackup(identity, "full", {
        source: "pre-restore",
      });

  const replaceMissingTables = envelope.metadata.replaceMissingTables ?? [];
  const theoryIdRemap = envelope.metadata.theoryIdRemap ?? [];
  const theoryScope = envelope.metadata.replaceMissingTheoryScope;
  const replacementScope = envelope.metadata.replacementScope ?? null;
  const replacementCourseScope = envelope.metadata.replacementCourseScope ?? null;
  const removedQuestionIds = envelope.metadata.removedQuestionIds ?? [];
  const immutableRows = Object.fromEntries([...IMMUTABLE_PERSONAL_TABLES]
    .filter(table => allowed.includes(table))
    .map(table => [table, envelope.data[table] ?? []]));
  if (mode === "full-replace" && [...IMMUTABLE_PERSONAL_TABLES]
    .some(table => allowed.includes(table) && !Object.hasOwn(envelope.data, table))) {
    throw new Error("전체 교체 백업에 개인 SKCT 불변 원본 데이터가 누락되었습니다.");
  }
  await verifyImmutablePersonalRows(immutableRows, mode === "full-replace");
  if (replaceMissingTables.includes("theories")) {
    const incomingIds = new Set((envelope.data.theories ?? []).map((row) => Number(row.id)));
    const existingRows = await allRows<{ id: number; category: string; exam_scope: string }>("SELECT id, category, exam_scope FROM theories");
    const belongsToScope = (row: typeof existingRows[number]) => !theoryScope || (
      row.category === theoryScope.category && row.exam_scope === theoryScope.examScope
    );
    if (existingRows.some((row) => incomingIds.has(Number(row.id)) && !belongsToScope(row))) {
      throw new Error("입력 이론 ID가 다른 과목의 기존 이론과 충돌합니다.");
    }
    const missingIds = existingRows.filter(belongsToScope).map((row) => Number(row.id)).filter((id) => !incomingIds.has(id));
    const remappedIds = theoryIdRemap.map(({ sourceId }) => sourceId).sort((left, right) => left - right);
    missingIds.sort((left, right) => left - right);
    if (JSON.stringify(missingIds) !== JSON.stringify(remappedIds)) {
      throw new Error("운영 이론 삭제 대상이 승인된 ID 통합표와 일치하지 않습니다.");
    }
  }

  const statements: SqlCommand[] = [];
  if (mode === "full-replace") {
    for (const table of BACKUP_DELETE_ORDER) {
      if (fullReplacementScope.includes(table) && !IMMUTABLE_PERSONAL_TABLES.has(table))
        statements.push({ sql: `DELETE FROM \`${table}\`` });
    }
  }
  if (mode !== "full-replace" && replacementScope) {
    statements.push({
      sql: `
        DELETE FROM exam_sessions
        WHERE EXISTS (
          SELECT 1 FROM exam_session_items item
          INNER JOIN questions question ON question.id = item.question_id
          WHERE item.session_id = exam_sessions.id
            AND question.category = ? AND question.exam_scope = ?
        )
      `,
      values: [replacementScope.category, replacementScope.examScope],
    });
  }
  if (mode !== "full-replace" && replacementCourseScope) {
    statements.push({
      sql: "DELETE FROM exam_sessions WHERE exam_type = ?",
      values: [replacementCourseScope.questionExamScope],
    });
    statements.push({
      sql: "DELETE FROM questions WHERE exam_scope = ?",
      values: [replacementCourseScope.questionExamScope],
    });
    statements.push({
      sql: `
        DELETE FROM theories
        WHERE exam_scope IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          AND category IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      `,
      values: [
        JSON.stringify(replacementCourseScope.theoryExamScopes),
        JSON.stringify(replacementCourseScope.categories),
      ],
    });
  }
  if (mode !== "full-replace" && removedQuestionIds.length > 0) {
    statements.push({
      sql: "DELETE FROM questions WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))",
      values: [JSON.stringify(removedQuestionIds)],
    });
  }
  for (const table of BACKUP_INSERT_ORDER) {
    if (allowed.includes(table)) {
      const restoreRows = restoredContentRows(
        table, envelope.data[table] ?? [],
        allowed.includes("content_releases") && (envelope.data.content_releases?.length ?? 0) > 0,
        envelope.metadata.type, envelope.metadata.schemaVersion,
      );
      for (const group of chunkRestoreRows(restoreRows)) {
        statements.push(restoreStatement(table, group));
      }
    }
  }
  if (allowed.includes("content_releases")) {
    const activeVersions = (envelope.data.content_releases ?? [])
      .filter((row) => row.status === "active")
      .map((row) => String(row.version));
    if (activeVersions.length === 1) {
      statements.unshift({
        sql: "UPDATE content_releases SET status = 'verified', activated_at = NULL WHERE status = 'active' AND version <> ?",
        values: activeVersions,
      });
    }
  }
  if (replaceMissingTables.includes("theories")) {
    const serializedRemap = JSON.stringify(theoryIdRemap);
    statements.push({
      sql: `
        UPDATE questions
        SET theory_id = (
          SELECT CAST(json_extract(mapping.value, '$.canonicalId') AS INTEGER)
          FROM json_each(?) mapping
          WHERE CAST(json_extract(mapping.value, '$.sourceId') AS INTEGER) = questions.theory_id
        )
        WHERE theory_id IN (
          SELECT CAST(json_extract(mapping.value, '$.sourceId') AS INTEGER)
          FROM json_each(?) mapping
        )
      `,
      values: [serializedRemap, serializedRemap],
    });
    statements.push({
      sql: `DELETE FROM theories WHERE id NOT IN (SELECT CAST(value AS INTEGER) FROM json_each(?))${theoryScope ? " AND category = ? AND exam_scope = ?" : ""}`,
      values: [JSON.stringify((envelope.data.theories ?? []).map((row) => Number(row.id))), ...(theoryScope ? [theoryScope.category, theoryScope.examScope] : [])],
    });
  }
  if (allowed.includes("study_groups")) statements.push(...GROUP_OWNER_SLOT_RECOVERY_SQL.map(sql => ({sql})));
  if (mode === "full-replace") statements.push(...immutablePersonalCountGuards(immutableRows));
  if (!statements.length) throw new Error("복원할 데이터가 없습니다.");
  await adminRepository.batch(statements);

  const verification: Record<string, number> = {};
  const verificationTables = mode === "full-replace" ? fullReplacementScope : allowed;
  for (const table of verificationTables) {
    const generatedRevision = table === "site_settings"
      && !(envelope.data.site_settings ?? []).some((row) => row.key === "content_cache_revision");
    const scopedTheory = table === "theories" && theoryScope;
    const where = generatedRevision ? " WHERE key != 'content_cache_revision'"
      : scopedTheory ? " WHERE category = ? AND exam_scope = ?" : "";
    const count = await firstRow<{ count: number }>(
      `SELECT COUNT(*) AS count FROM \`${table}\`${where}`,
      scopedTheory ? [scopedTheory.category, scopedTheory.examScope] : [],
    );
    verification[table] = Number(count?.count ?? 0);
    if (mode === "full-replace" || replaceMissingTables.includes(table)) {
      const expected = allowed.includes(table) ? (envelope.data[table]?.length ?? 0) : 0;
      if (verification[table] !== expected) {
        throw new Error(`${table} 복원 검증 건수가 일치하지 않습니다.`);
      }
    }
  }
  const restoredMatches = await backupConflicts({
    ...envelope,
    metadata: { ...envelope.metadata, includedData: allowed },
  });
  for (const table of allowed) {
    if (restoredMatches[table]?.existingIds !== (envelope.data[table]?.length ?? 0)) {
      throw new Error(`${table} 복원 후 기본 키 검증에 실패했습니다.`);
    }
  }
  if (replacementScope) {
    const expected = (envelope.data.questions ?? []).filter((row) => (
      row.category === replacementScope.category && row.exam_scope === replacementScope.examScope
    )).length;
    const actual = await firstRow<{ count: number }>(`
      SELECT COUNT(*) AS count FROM questions WHERE category = ? AND exam_scope = ?
    `, [replacementScope.category, replacementScope.examScope]);
    if (Number(actual?.count ?? 0) !== expected) {
      throw new Error("문제 교체 후 범위별 검증 건수가 일치하지 않습니다.");
    }
  }
  if (replacementCourseScope) {
    const expectedQuestions = (envelope.data.questions ?? []).length;
    const expectedTheories = (envelope.data.theories ?? []).length;
    const actualQuestions = await firstRow<{ count: number }>(
      "SELECT COUNT(*) AS count FROM questions WHERE exam_scope = ?",
      [replacementCourseScope.questionExamScope],
    );
    const actualTheories = await firstRow<{ count: number }>(`
      SELECT COUNT(*) AS count FROM theories
      WHERE exam_scope IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        AND category IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `, [
      JSON.stringify(replacementCourseScope.theoryExamScopes),
      JSON.stringify(replacementCourseScope.categories),
    ]);
    if (
      Number(actualQuestions?.count ?? 0) !== expectedQuestions
      || Number(actualTheories?.count ?? 0) !== expectedTheories
    ) {
      throw new Error("과정 전체 폐기 교체 후 범위별 검증 건수가 일치하지 않습니다.");
    }
  }
  return {
    mode,
    safetyBackupId: safetyBackup?.id ?? null,
    safetyBackupSkipped: safetyBackup === null,
    restoredTables: allowed,
    clearedTables: mode === "full-replace" ? fullReplacementScope : [],
    incomingCounts: envelope.metadata.counts,
    verification,
  };
}
