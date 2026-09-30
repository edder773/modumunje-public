import { createHash } from "node:crypto";
import { BACKUP_SCHEMA_VERSION, RESTORE_TABLES, allowedBackupTables } from "@shared/admin/backup-contract.mjs";
import { stripTheoryDifficultyMetadata } from "@shared/content/content-format.mjs";
import { writeAdminAudit } from "@backend/common/observability";
import { jsonResponse, type AdminIdentity, type D1Row } from "./admin-use-case-runtime";
import { invalidateQualitySnapshot } from "./admin-quality-use-cases";
import { adminRepository } from "./admin.repository";
import { readExternalBackup } from "./admin-external-backup-use-cases";

// This is a one-time repair of the observed historical whitespace drift, not
// a general content import. A new release or different baseline needs review.
const RELEASE_VERSION = "learning-2026.09.13.6";
const BEFORE_THEORY_SHA = "b05bb2c2ccbcc203372edcc543f4f20ccbefd0912cbc28896851f68c0b748ad3";
const AFTER_THEORY_SHA = "6af0c6dff8103c63ab28237146c52365b5e48b6ff45811aa47f64426518b7955";
const QUESTION_SHA = "95eb5d174893d7e8d1ffaaadaa80a65702c8c6693585d98bbec5bb1078c67fe3";
const QUESTION_COUNT = 11_084;
const THEORY_COUNT = 523;
const REPAIR_COUNT = 106;
const PACKAGE_LIMIT_BYTES = 4 * 1024 * 1024;
const BACKUP_MAX_AGE_MS = 2 * 60 * 60 * 1000;
// 15 pages per full question hash keeps preview/run below D1's 50-query
// Free-tier invocation ceiling even with the transactional update and audit.
const QUESTION_PAGE_ROWS = 750;
const HASH = /^[a-f0-9]{64}$/u;
const THEORY_COLUMNS = [
  "id", "title", "category", "topic", "sort_order", "exam_scope", "difficulty",
  "active", "summary", "content", "review_answers", "keywords", "created_at", "updated_at",
] as const;
const QUESTION_COLUMNS = RESTORE_TABLES.questions.columns as string[];

type RepairRow = {
  id: number;
  current: string;
  target: string;
  currentSha256: string;
  targetSha256: string;
};
type RepairPackage = {
  format: "theory-whitespace-repair-v1";
  releaseVersion: string;
  sourceChecksum: string;
  questionChecksum: string;
  theoryBeforeChecksum: string;
  theoryAfterChecksum: string;
  contentCacheRevision: string;
  backupId: string;
  rows: RepairRow[];
};
type CanonicalState = {
  questions: { hash: string; count: number };
  theories: { hash: string; count: number; rows: D1Row[] };
};
type ReleaseRow = {
  version: string; schema_version: string; status: string; source_checksum: string;
  question_checksum: string; theory_checksum: string;
  imported_question_count: number; imported_theory_count: number;
};
type BackupRow = {
  id: string; backup_type: string; status: string; schema_version: string;
  included_data: string; counts: string; checksum: string; payload: string;
  byte_size: number; created_at: string;
};

function sha(value: string) { return createHash("sha256").update(value).digest("hex"); }
function fail(reason: string): never { throw new Error(reason); }
function strictWhitespace(value: string) { return value.replace(/\s+/gu, ""); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
export function parsePackage(value: unknown): RepairPackage {
  if (!isRecord(value)) fail("복구 패키지 형식이 올바르지 않습니다.");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > PACKAGE_LIMIT_BYTES) {
    fail("복구 패키지가 허용된 크기를 초과했습니다.");
  }
  const keys = ["format", "releaseVersion", "sourceChecksum", "questionChecksum",
    "theoryBeforeChecksum", "theoryAfterChecksum", "contentCacheRevision", "backupId", "rows"];
  if (!exactKeys(value, keys) || value.format !== "theory-whitespace-repair-v1"
    || value.releaseVersion !== RELEASE_VERSION || value.questionChecksum !== QUESTION_SHA
    || value.theoryBeforeChecksum !== BEFORE_THEORY_SHA
    || value.theoryAfterChecksum !== AFTER_THEORY_SHA
    || typeof value.sourceChecksum !== "string" || !HASH.test(value.sourceChecksum)
    || typeof value.contentCacheRevision !== "string" || !value.contentCacheRevision
    || typeof value.backupId !== "string" || !/^[a-f0-9-]{36}$/u.test(value.backupId)
    || !Array.isArray(value.rows) || value.rows.length !== REPAIR_COUNT) {
    fail("복구 패키지가 검토된 릴리스·건수·체크섬 계약과 다릅니다.");
  }
  const ids = new Set<number>();
  for (const row of value.rows) {
    if (!isRecord(row) || !exactKeys(row, ["id", "current", "target", "currentSha256", "targetSha256"])
      || !Number.isSafeInteger(row.id) || Number(row.id) <= 0 || ids.has(Number(row.id))
      || typeof row.current !== "string" || typeof row.target !== "string"
      || row.current === row.target || typeof row.currentSha256 !== "string"
      || typeof row.targetSha256 !== "string" || sha(row.current) !== row.currentSha256
      || sha(row.target) !== row.targetSha256
      || strictWhitespace(row.current) !== strictWhitespace(row.target)
      || stripTheoryDifficultyMetadata(row.target) !== row.current) {
      fail("복구 대상은 중복 없이 기존 정규화의 공백 역변환만 허용됩니다.");
    }
    ids.add(Number(row.id));
  }
  return value as RepairPackage;
}

function hashRows(rows: D1Row[]) { return sha(JSON.stringify(rows)); }

async function readQuestionsHash() {
  const digest = createHash("sha256");
  digest.update("[");
  let cursor: { display_order: number; id: number } | null = null;
  let count = 0;
  for (;;) {
    const where: string = cursor ? "WHERE display_order > ? OR (display_order = ? AND id > ?)" : "";
    const values: number[] = cursor
      ? [cursor.display_order, cursor.display_order, cursor.id, QUESTION_PAGE_ROWS]
      : [QUESTION_PAGE_ROWS];
    const rows: D1Row[] = await adminRepository.all<D1Row>(
      `SELECT ${QUESTION_COLUMNS.join(", ")} FROM questions ${where} ORDER BY display_order, id LIMIT ?`,
      values,
    );
    for (const row of rows) {
      digest.update(count ? "," : "").update(JSON.stringify(row));
      count += 1;
    }
    if (rows.length < QUESTION_PAGE_ROWS) break;
    const last: D1Row = rows.at(-1)!;
    cursor = { display_order: Number(last.display_order), id: Number(last.id) };
  }
  return { hash: digest.update("]").digest("hex"), count };
}

export async function readCanonicalState(): Promise<CanonicalState> {
  const questions = await readQuestionsHash();
  const rows = await adminRepository.all<D1Row>(
    `SELECT ${THEORY_COLUMNS.join(", ")} FROM theories ORDER BY category, sort_order, id`,
  );
  return { questions, theories: { hash: hashRows(rows), count: rows.length, rows } };
}

async function readRelease() {
  const rows = await adminRepository.all<ReleaseRow>(
    "SELECT version, schema_version, status, source_checksum, question_checksum, theory_checksum, imported_question_count, imported_theory_count FROM content_releases WHERE status = 'active'",
  );
  if (rows.length !== 1) fail("활성 콘텐츠 릴리스가 정확히 하나여야 합니다.");
  return rows[0];
}

async function readRevision() {
  const row = await adminRepository.first<{ value: string }>(
    "SELECT value FROM site_settings WHERE key = 'content_cache_revision'",
  );
  return row?.value ?? "0";
}

async function verifyBackup(backupId: string) {
  const latest = await adminRepository.first<BackupRow>(`
    SELECT id, backup_type, status, schema_version, included_data, counts,
           checksum, payload, byte_size, created_at
    FROM backup_snapshots
    WHERE status = 'completed' AND backup_type IN ('full', 'auto-full', 'pre-restore-full')
    ORDER BY created_at DESC, id DESC LIMIT 1
  `);
  const ageMs = Date.now() - Date.parse(latest?.created_at ?? "");
  if (!latest || latest.id !== backupId || latest.schema_version !== BACKUP_SCHEMA_VERSION
    || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > BACKUP_MAX_AGE_MS
    || !HASH.test(latest.checksum) || Number(latest.byte_size) <= 0) {
    fail("최근 2시간 안에 완료된 최신 admin-9 전체 백업 ID가 필요합니다.");
  }
  let tables: string[];
  let counts: Record<string, number>;
  let descriptor: Record<string, unknown>;
  try {
    tables = JSON.parse(latest.included_data) as string[];
    counts = JSON.parse(latest.counts) as Record<string, number>;
    descriptor = JSON.parse(latest.payload) as Record<string, unknown>;
  } catch { fail("전체 백업의 범위 메타데이터를 확인할 수 없습니다."); }
  const required = allowedBackupTables("full");
  if (!Array.isArray(tables) || required.some((table) => !tables.includes(table))
    || required.some((table) => !Number.isSafeInteger(counts[table]) || counts[table] < 0)
    || counts.questions !== QUESTION_COUNT || counts.theories !== THEORY_COUNT
    || descriptor.kind !== "external") {
    fail("최신 전체 백업이 필요한 50개 테이블과 비공개 외부 저장 계약을 충족하지 않습니다.");
  }
  const external = await readExternalBackup(backupId);
  if (!external || external.manifest.metadata.type !== "full"
    || external.manifest.metadata.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    fail("전체 백업 매니페스트를 검증할 수 없습니다.");
  }
  return { id: backupId, checksum: latest.checksum, createdAt: latest.created_at };
}

async function inspect(value: unknown) {
  const repair = parsePackage(value);
  const [release, revision, backup, state] = await Promise.all([
    readRelease(), readRevision(), verifyBackup(repair.backupId), readCanonicalState(),
  ]);
  if (release.version !== repair.releaseVersion || release.schema_version !== "content-v2"
    || release.source_checksum !== repair.sourceChecksum
    || release.question_checksum !== repair.questionChecksum
    || release.theory_checksum !== repair.theoryAfterChecksum
    || Number(release.imported_question_count) !== QUESTION_COUNT
    || Number(release.imported_theory_count) !== THEORY_COUNT
    || revision !== repair.contentCacheRevision
    || state.questions.count !== QUESTION_COUNT || state.questions.hash !== QUESTION_SHA
    || state.theories.count !== THEORY_COUNT || state.theories.hash !== BEFORE_THEORY_SHA) {
    fail("활성 릴리스·콘텐츠·수정 revision이 검토된 복구 기준과 달라 중단했습니다.");
  }
  const byId = new Map(state.theories.rows.map((row) => [Number(row.id), row]));
  const targets = new Map<number, string>();
  for (const row of repair.rows) {
    if (byId.get(row.id)?.content !== row.current) fail("복구 대상 이론의 현재값이 변경되어 중단했습니다.");
    targets.set(row.id, row.target);
  }
  const afterRows = state.theories.rows.map((row) => (
    targets.has(Number(row.id)) ? { ...row, content: targets.get(Number(row.id)) } : row
  ));
  if (hashRows(afterRows) !== AFTER_THEORY_SHA) {
    fail("복구 후 전체 이론 체크섬이 활성 릴리스와 다릅니다.");
  }
  return { repair, release, revision, backup,
    packageSha256: sha(JSON.stringify(repair)),
    before: { questions: state.questions.hash, theories: state.theories.hash },
    after: { questions: state.questions.hash, theories: AFTER_THEORY_SHA },
  };
}

export async function previewTheoryContentRepair(value: unknown) {
  const reviewed = await inspect(value);
  return {
    packageSha256: reviewed.packageSha256,
    releaseVersion: reviewed.release.version,
    backupId: reviewed.backup.id,
    backupCreatedAt: reviewed.backup.createdAt,
    changedTheories: REPAIR_COUNT,
    questionCount: QUESTION_COUNT,
    theoryCount: THEORY_COUNT,
    before: reviewed.before,
    after: reviewed.after,
    confirmation: `REPAIR ${RELEASE_VERSION} ${reviewed.packageSha256}`,
  };
}

export function repairBatchStatements(
  repair: RepairPackage, release: ReleaseRow, revision: string,
  backup: { id: string; checksum: string },
) {
  const rowsJson = JSON.stringify(repair.rows.map((row) => ({
    id: row.id, current: row.current, target: row.target,
  })));
  const guard = "SELECT CASE WHEN ";
  const failSql = " THEN 1 ELSE abs(-9223372036854775808) END AS verified";
  const currentGuard = `(SELECT COUNT(*) FROM json_each(?) repair JOIN theories t
    ON t.id = CAST(json_extract(repair.value, '$.id') AS INTEGER)
    WHERE t.content = json_extract(repair.value, '$.current')) = ${REPAIR_COUNT}`;
  const backupGuard = `(SELECT id FROM backup_snapshots
    WHERE status = 'completed' AND backup_type IN ('full', 'auto-full', 'pre-restore-full')
    ORDER BY created_at DESC, id DESC LIMIT 1) = ?
    AND EXISTS (SELECT 1 FROM backup_snapshots WHERE id = ? AND status = 'completed'
      AND schema_version = ? AND checksum = ? AND byte_size > 0
      AND julianday(created_at) >= julianday('now', '-2 hours'))`;
  return [
    { sql: `${guard}
      (SELECT COUNT(*) FROM content_releases WHERE status = 'active') = 1
      AND (SELECT COUNT(*) FROM content_releases WHERE status = 'active' AND version = ?
        AND source_checksum = ? AND question_checksum = ? AND theory_checksum = ?) = 1
      AND COALESCE((SELECT value FROM site_settings WHERE key = 'content_cache_revision'), '0') = ?
      AND ${backupGuard} AND ${currentGuard}${failSql}`,
      values: [release.version, release.source_checksum, QUESTION_SHA,
        AFTER_THEORY_SHA, revision, backup.id, backup.id,
        BACKUP_SCHEMA_VERSION, backup.checksum, rowsJson] },
    { sql: `UPDATE theories SET content = (
        SELECT json_extract(repair.value, '$.target') FROM json_each(?) repair
        WHERE CAST(json_extract(repair.value, '$.id') AS INTEGER) = theories.id
      ) WHERE id IN (SELECT CAST(json_extract(value, '$.id') AS INTEGER) FROM json_each(?))
        AND content = (SELECT json_extract(repair.value, '$.current') FROM json_each(?) repair
          WHERE CAST(json_extract(repair.value, '$.id') AS INTEGER) = theories.id)`,
      values: [rowsJson, rowsJson, rowsJson] },
    { sql: `${guard}changes() = ${REPAIR_COUNT}
      AND (SELECT COUNT(*) FROM json_each(?) repair JOIN theories t
        ON t.id = CAST(json_extract(repair.value, '$.id') AS INTEGER)
        WHERE t.content = json_extract(repair.value, '$.target')) = ${REPAIR_COUNT}
      ${failSql}`, values: [rowsJson] },
  ];
}

export async function runTheoryContentRepair(
  value: unknown,
  previewSha: unknown,
  confirmation: unknown,
) {
  const reviewed = await inspect(value);
  if (previewSha !== reviewed.packageSha256
    || confirmation !== `REPAIR ${RELEASE_VERSION} ${reviewed.packageSha256}`) {
    fail("미리보기와 실행 확인 문구가 일치하지 않습니다.");
  }
  await adminRepository.batch(repairBatchStatements(
    reviewed.repair, reviewed.release, reviewed.revision, reviewed.backup,
  ));
  const [release, state, revision] = await Promise.all([readRelease(), readCanonicalState(), readRevision()]);
  const foreignKeys = await adminRepository.all<D1Row>("PRAGMA foreign_key_check");
  if (release.version !== RELEASE_VERSION || release.source_checksum !== reviewed.release.source_checksum
    || release.question_checksum !== QUESTION_SHA || release.theory_checksum !== AFTER_THEORY_SHA
    || state.questions.hash !== QUESTION_SHA || state.questions.count !== QUESTION_COUNT
    || state.theories.hash !== AFTER_THEORY_SHA || state.theories.count !== THEORY_COUNT
    || revision === reviewed.revision || foreignKeys.length) {
    fail("복구 배치는 적용됐지만 사후 전체 무결성 확인이 실패했습니다. 전체 백업을 보존하고 재실행하지 마세요.");
  }
  return {
    repaired: REPAIR_COUNT, releaseVersion: RELEASE_VERSION,
    packageSha256: reviewed.packageSha256, backupId: reviewed.backup.id,
    theoryChecksum: state.theories.hash, questionChecksum: state.questions.hash,
    cacheRevisionChanged: true,
  };
}

export async function readTheoryContentRepairStatus(value: unknown, previewSha: unknown) {
  const repair = parsePackage(value);
  const packageSha256 = sha(JSON.stringify(repair));
  if (previewSha !== packageSha256) fail("상태 확인 패키지와 미리보기 SHA가 다릅니다.");
  const [release, revision, state] = await Promise.all([
    readRelease(), readRevision(), readCanonicalState(),
  ]);
  const releaseMatches = release.version === RELEASE_VERSION
    && release.schema_version === "content-v2"
    && release.source_checksum === repair.sourceChecksum
    && release.question_checksum === QUESTION_SHA
    && release.theory_checksum === AFTER_THEORY_SHA;
  const questionsMatch = state.questions.count === QUESTION_COUNT
    && state.questions.hash === QUESTION_SHA;
  const theoryById = new Map(state.theories.rows.map((row) => [Number(row.id), row.content]));
  const targetMatches = repair.rows.every((row) => theoryById.get(row.id) === row.target);
  const after = releaseMatches && questionsMatch && state.theories.count === THEORY_COUNT
    && state.theories.hash === AFTER_THEORY_SHA && targetMatches
    && revision !== repair.contentCacheRevision;
  const before = releaseMatches && questionsMatch && state.theories.count === THEORY_COUNT
    && state.theories.hash === BEFORE_THEORY_SHA
    && revision === repair.contentCacheRevision;
  const receipt = after ? await adminRepository.first<{ id: string }>(`
    SELECT id FROM admin_audit_logs
    WHERE action = 'theory-content-repair-run' AND target_type = 'theory-repair'
      AND success = 1
      AND CASE WHEN json_valid(after_summary)
        THEN json_extract(after_summary, '$.packageSha256') ELSE NULL END = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `, [packageSha256]) : null;
  return {
    state: after ? "target-present" : before ? "baseline-present" : "unverified",
    packageSha256, auditReceiptId: receipt?.id ?? null,
    releaseVersion: release.version,
    questionChecksum: state.questions.hash, theoryChecksum: state.theories.hash,
    contentCacheRevisionChanged: revision !== repair.contentCacheRevision,
  };
}

// Called only after the shared admin authentication and CSRF check in POST.
export async function handleTheoryContentRepair(
  identity: AdminIdentity, action: string, payload: Record<string, unknown>,
) {
  if (action === "theory-content-repair-preview")
    return jsonResponse(await previewTheoryContentRepair(payload.repairPackage));
  if (action === "theory-content-repair-status")
    return jsonResponse(await readTheoryContentRepairStatus(payload.repairPackage, payload.previewSha256));
  if (action !== "theory-content-repair-run") fail("지원하지 않는 복구 작업입니다.");
  const result = await runTheoryContentRepair(
    payload.repairPackage, payload.previewSha256, payload.confirmation,
  );
  await invalidateQualitySnapshot();
  await writeAdminAudit({
    adminUserHash: identity.hash, action, targetType: "theory-repair",
    targetId: RELEASE_VERSION, after: result,
  });
  return jsonResponse(result);
}
