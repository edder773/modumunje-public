import { getD1 } from "@backend/infrastructure/database";
import { BACKUP_SCHEMA_VERSION, PREVIOUS_BACKUP_SCHEMA_VERSION } from "@shared/admin/backup-contract.mjs";
import type { AdminIdentity } from "./admin-use-case-runtime";
import type { BankQuestion, SkctBank } from "./admin-skct-bank-use-cases";

const NEW_BANK_SCHEMA = "baeumzip.skct-group-bank.v2";
const GROUP_ACTIVATION_BACKUP_SCHEMA = {
  "0559": "admin-6",
  "0560": "admin-7",
  "0561": PREVIOUS_BACKUP_SCHEMA_VERSION,
  "0562": BACKUP_SCHEMA_VERSION,
  "0563": BACKUP_SCHEMA_VERSION,
} as const;

function backupSchemaForGroupActivation(migrationVersion: string) {
  // These mappings are reviewed against the forward-only migrations and the
  // full-backup table contract. Do not silently accept a future backup format.
  if (BACKUP_SCHEMA_VERSION !== "admin-9" || PREVIOUS_BACKUP_SCHEMA_VERSION !== "admin-8") {
    throw new Error("SKCT 활성화 백업 schema 매핑을 다시 검증해야 합니다.");
  }
  return GROUP_ACTIVATION_BACKUP_SCHEMA[migrationVersion as keyof typeof GROUP_ACTIVATION_BACKUP_SCHEMA];
}
function areaCounts(bank: SkctBank) {
  return Object.fromEntries(["언어이해", "자료해석", "창의수리", "언어추리", "수열추리"].map((area) => [
    area, bank.questions.filter((question) => question.areaCode === area).length,
  ]).filter(([, count]) => Number(count) > 0));
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function activationSummary(bank: SkctBank) {
  const normalizedCount = bank.schema === NEW_BANK_SCHEMA ? bank.questions.length : 500;
  return { canActivate: true, releaseId: bank.releaseId, releaseSha256: bank.releaseSha256,
    eligibleCount: bank.questions.length, quarantineCount: normalizedCount - bank.questions.length,
    assetCount: bank.questions.reduce((count, question) => count + question.assets.length, 0),
    areas: areaCounts(bank), confirmation: `ACTIVATE ${bank.releaseId} ${bank.releaseSha256}` };
}
function publicHashInput(question: BankQuestion) {
  return JSON.stringify({
    promptMd: question.promptMd,
    choices: question.choices,
    assets: question.assets,
    source: question.provenance.question,
  });
}

function secretHashInput(question: BankQuestion) {
  return JSON.stringify({
    correctAnswers: question.correctAnswers,
    explanationMd: question.explanationMd,
    source: question.provenance.answerExplanation,
  });
}

async function verifyExistingRelease(bank: SkctBank) {
  const database = getD1();
  const release = await database.prepare(`
    SELECT id, status, release_sha256, eligible_count
    FROM skct_content_releases
    WHERE id = ? OR release_sha256 = ?
    ORDER BY id = ? DESC LIMIT 1
  `).bind(bank.releaseId, bank.releaseSha256, bank.releaseId).first<Record<string, unknown>>();
  if (!release) return null;
  if (release.id !== bank.releaseId || release.release_sha256 !== bank.releaseSha256
    || Number(release.eligible_count) !== bank.questions.length) {
    throw new Error("같은 ID 또는 SHA의 SKCT release가 다른 내용으로 이미 존재합니다.");
  }
  const counts = await database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM skct_question_public WHERE release_id = ?) AS public_count,
      (SELECT COUNT(*) FROM skct_question_secret WHERE release_id = ?) AS secret_count,
      (SELECT COUNT(*) FROM skct_question_public p
        JOIN skct_question_secret s USING (release_id, question_uid)
        WHERE p.release_id = ? AND p.eligibility = 'eligible') AS selectable_count
  `).bind(bank.releaseId, bank.releaseId, bank.releaseId).first<Record<string, unknown>>();
  if (Number(counts?.public_count) !== bank.questions.length
    || Number(counts?.secret_count) !== bank.questions.length
    || Number(counts?.selectable_count) !== bank.questions.length) {
    throw new Error("기존 SKCT release의 public/secret 문항 수가 검증본과 다릅니다.");
  }
  const rows = (await database.prepare(`
    SELECT p.question_uid, p.question_hash, s.secret_hash
    FROM skct_question_public p
    JOIN skct_question_secret s USING (release_id, question_uid)
    WHERE p.release_id = ? AND p.eligibility = 'eligible'
    ORDER BY p.question_uid
  `).bind(bank.releaseId).all<{
    question_uid: string;
    question_hash: string;
    secret_hash: string;
  }>()).results ?? [];
  const expected = new Map(await Promise.all(bank.questions.map(async (question) => [
    question.questionUid,
    {
      questionHash: await sha256(publicHashInput(question)),
      secretHash: await sha256(secretHashInput(question)),
    },
  ] as const)));
  if (rows.some((row) => {
    const hashes = expected.get(row.question_uid);
    return !hashes || hashes.questionHash !== row.question_hash || hashes.secretHash !== row.secret_hash;
  })) throw new Error("기존 SKCT release의 문항 hash가 검증본과 다릅니다.");
  return release;
}

export async function persistSkctValidatedBank(identity: AdminIdentity, bank: SkctBank, confirmation: unknown) {
  if (confirmation !== `ACTIVATE ${bank.releaseId} ${bank.releaseSha256}`) {
    throw new Error("SKCT 문제은행 활성화 확인 문구가 일치하지 않습니다.");
  }
  const database = getD1();
  const schema = await database.prepare(
    "SELECT migration_version FROM app_schema_state WHERE id = 1",
  ).first<{ migration_version: string }>();
  const requiredBackupSchema = backupSchemaForGroupActivation(schema?.migration_version ?? "");
  if (!requiredBackupSchema) {
    throw new Error(`운영 schema 0559 적용 후에만 SKCT 문제은행을 활성화할 수 있습니다. 현재 ${schema?.migration_version ?? "없음"}`);
  }
  const existing = await verifyExistingRelease(bank);
  if (existing?.status === "active") {
    return { ...activationSummary(bank), activated: true, replayed: true };
  }
  const backup = await database.prepare(`
    SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS reference_at
    FROM backup_snapshots
    WHERE status = 'completed'
      AND backup_type IN ('full', 'auto-full')
      AND schema_version = ?
      AND checksum <> ''
      AND byte_size > 0
      AND julianday(created_at) >= julianday('now', '-24 hours')
    ORDER BY created_at DESC LIMIT 1
  `).bind(requiredBackupSchema).first<{ id: string; reference_at: string }>();
  const referenceTime = Date.parse(backup?.reference_at ?? "");
  if (!backup?.id || !Number.isFinite(referenceTime)) {
    throw new Error(`최근 24시간 안에 완료된 ${requiredBackupSchema} full backup을 먼저 만들어야 합니다.`);
  }

  const timestamp = new Date(referenceTime).toISOString();
  const backupCutoff = new Date(referenceTime - 24 * 60 * 60 * 1_000).toISOString();
  const backupGuard = `EXISTS (
    SELECT 1 FROM backup_snapshots
    WHERE id = ?
      AND status = 'completed'
      AND backup_type IN ('full', 'auto-full')
      AND schema_version = ?
      AND checksum <> ''
      AND byte_size > 0
      AND julianday(created_at) >= julianday(?)
  )`;
  const statements: D1PreparedStatement[] = [
    database.prepare(`
      UPDATE skct_content_releases SET status = 'retired'
      WHERE status = 'active' AND ${backupGuard}
    `).bind(backup.id, requiredBackupSchema, backupCutoff),
  ];
  const authored = bank.schema === NEW_BANK_SCHEMA;
  if (existing) {
    statements.push(database.prepare(`
      UPDATE skct_content_releases SET status = 'active'
      WHERE id = ? AND release_sha256 = ? AND ${backupGuard}
    `).bind(bank.releaseId, bank.releaseSha256, backup.id, requiredBackupSchema, backupCutoff));
  } else {
    statements.push(database.prepare(`
      INSERT INTO skct_content_releases (
        id, status, dataset, schema_version, completed_folder_id,
        json_file_id, json_sha256, md_file_id, md_sha256, license_note,
        manifest_json, normalized_count, eligible_count, quarantine_count,
        release_sha256, created_at
      ) SELECT ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ${backupGuard}
    `).bind(
      bank.releaseId, bank.dataset, bank.schema,
      authored ? "" : bank.source.completedFolderId,
      authored ? "" : bank.source.jsonFileId,
      authored ? bank.releaseSha256 : bank.source.jsonSha256,
      authored ? "" : bank.source.mdFileId,
      authored ? "" : bank.source.mdSha256,
      authored
        ? "Newly authored practice candidate; source archive hashes recorded. External rights review is separate."
        : "Legacy source retained for historical compatibility.",
      JSON.stringify({ choiceIndexBase: bank.choiceIndexBase, source: bank.source, areas: areaCounts(bank) }),
      authored ? bank.questions.length : 500,
      bank.questions.length, authored ? 0 : 500 - bank.questions.length, bank.releaseSha256, timestamp,
      backup.id, requiredBackupSchema, backupCutoff,
    ));
    for (const question of bank.questions) {
      statements.push(database.prepare(`
        INSERT INTO skct_question_public (
          release_id, question_uid, content_set, area_code, question_no, kind,
          prompt_md, choices_json, dependency_group_id, asset_refs_json,
          question_source_refs_json, question_hash, eligibility, quarantine_reasons_json
        ) SELECT ?, ?, ?, ?, ?, 'single', ?, ?, ?, ?, ?, ?, 'eligible', '[]'
        WHERE ${backupGuard}
          AND EXISTS (
            SELECT 1 FROM skct_content_releases
            WHERE id = ? AND status = 'active' AND release_sha256 = ?
          )
      `).bind(
        bank.releaseId, question.questionUid, question.contentSet, question.areaCode,
        question.questionNo, question.promptMd, JSON.stringify(question.choices),
        question.dependencyGroupId, JSON.stringify(question.assets),
        JSON.stringify(question.provenance.question), await sha256(publicHashInput(question)),
        backup.id, requiredBackupSchema, backupCutoff, bank.releaseId, bank.releaseSha256,
      ));
      statements.push(database.prepare(`
        INSERT INTO skct_question_secret (
          release_id, question_uid, correct_answers_json, explanation_md,
          answer_source_refs_json, secret_hash
        ) SELECT ?, ?, ?, ?, ?, ?
        WHERE ${backupGuard}
          AND EXISTS (
            SELECT 1 FROM skct_content_releases
            WHERE id = ? AND status = 'active' AND release_sha256 = ?
          )
          AND EXISTS (
            SELECT 1 FROM skct_question_public
            WHERE release_id = ? AND question_uid = ? AND eligibility = 'eligible'
          )
      `).bind(
        bank.releaseId, question.questionUid, JSON.stringify(question.correctAnswers),
        question.explanationMd, JSON.stringify(question.provenance.answerExplanation),
        await sha256(secretHashInput(question)), backup.id, requiredBackupSchema, backupCutoff,
        bank.releaseId, bank.releaseSha256, bank.releaseId, question.questionUid,
      ));
    }
  }
  statements.push(database.prepare(`
    INSERT INTO admin_audit_logs (
      id, admin_user_hash, action, target_type, target_id,
      before_summary, after_summary, success, failure_reason, created_at
    ) SELECT ?, ?, 'skct_bank_activated', 'skct-content-release', ?, '{}', ?, 1, '', ?
    WHERE ${backupGuard}
      AND EXISTS (
        SELECT 1 FROM skct_content_releases
        WHERE id = ? AND status = 'active' AND release_sha256 = ?
      )
  `).bind(
    crypto.randomUUID(), identity.hash, bank.releaseId,
    JSON.stringify({ releaseSha256: bank.releaseSha256, eligibleCount: bank.questions.length, areas: areaCounts(bank) }),
    timestamp, backup.id, requiredBackupSchema, backupCutoff, bank.releaseId, bank.releaseSha256,
  ));
  try {
    await database.batch(statements);
  } catch (error) {
    const concurrent = await verifyExistingRelease(bank);
    if (concurrent?.status === "active") {
      return { ...activationSummary(bank), activated: true, replayed: true };
    }
    throw error;
  }
  const verified = await verifyExistingRelease(bank);
  if (verified?.status !== "active") throw new Error("SKCT 문제은행 활성화 후 검증에 실패했습니다.");
  return { ...activationSummary(bank), activated: true, replayed: false };
}
