import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  activateSkctBank,
  previewSkctBankActivation,
  validateSkctBankForPersistence,
} from "../apps/backend/src/modules/admin/admin-skct-bank-use-cases";
import { persistSkctValidatedBank } from "../apps/backend/src/modules/admin/admin-skct-bank-persistence";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { syntheticSkctBank } from "./helpers/synthetic-skct-bank";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const actualBankPath = process.env.SKCT_GROUP_ACTIVATION_BANK?.trim();

function databaseAt0559() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of [
    "0554_schema_baseline.sql",
    "0555_ipe_practical_subject.sql",
    "0556_retire_theory_progress.sql",
    "0557_information_security_courses.sql",
    "0558_skct_group_exams.sql",
    "0559_skct_group_improvements.sql",
  ]) database.exec(readFileSync(path.join(root, "apps/backend/drizzle", name), "utf8"));
  return database;
}

function useDatabase(database: DatabaseSync) {
  const adapter = sqliteD1(database);
  let beforeBatch: (() => void) | null = null;
  globalThis.__BAEUMZIP_ENV__ = {
    DB: {
      ...adapter,
      async batch(statements: D1PreparedStatement[]) {
        const hook = beforeBatch;
        beforeBatch = null;
        hook?.();
        return adapter.batch(statements);
      },
    } as unknown as D1Database,
  };
  return (hook: () => void) => { beforeBatch = hook; };
}

function addActivationBackup(database: DatabaseSync) {
  database.prepare(`
    INSERT INTO backup_snapshots (
      id, backup_type, status, schema_version, app_version, included_data,
      counts, checksum, payload, byte_size, created_by_hash, created_at, error_message
    ) VALUES ('skct-activation-backup', 'full', 'completed', 'admin-6', 'test', '[]',
      '{}', ?, '{}', 2, 'admin-test-hash', ?, '')
  `).run("a".repeat(64), new Date().toISOString());
}

const identity = { email: "admin@example.invalid", hash: "admin-test-hash" };
const scalar = (database: DatabaseSync, sql: string) => Number(database.prepare(sql).get()?.value ?? -1);

async function contractPreview(value: unknown) {
  const bank = await validateSkctBankForPersistence(value);
  return { canActivate: true, releaseSha256: bank.releaseSha256, eligibleCount: bank.questions.length,
    areas: Object.fromEntries(["언어이해", "자료해석", "창의수리", "언어추리", "수열추리"]
      .map(area => [area, bank.questions.filter(question => question.areaCode === area).length])),
    confirmation: `ACTIVATE ${bank.releaseId} ${bank.releaseSha256}` };
}
async function contractActivate(identity: { email: string; hash: string }, value: unknown, confirmation: string) {
  return persistSkctValidatedBank(identity, await validateSkctBankForPersistence(value), confirmation);
}

async function releaseVariant(bank: Record<string, unknown>, suffix: string) {
  const variant = structuredClone(bank);
  variant.releaseId = `${String(variant.releaseId)}-${suffix}`;
  delete variant.releaseSha256;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(variant)));
  variant.releaseSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return variant;
}

test("validated synthetic 50 bank activates atomically, keeps answers private, and replays safely", async () => {
  const bank = syntheticSkctBank();
  const preview = await contractPreview(bank);
  assert.equal(preview.canActivate, true);
  assert.equal(preview.releaseSha256, "73426dda8907bab2341508326216c9e653d9c89a65da5ea05508cb13da067527");
  assert.deepEqual(preview.areas, { 언어이해: 10, 자료해석: 10, 창의수리: 10, 언어추리: 10, 수열추리: 10 });

  const database = databaseAt0559();
  addActivationBackup(database);
  useDatabase(database);
  try {
    const result = await contractActivate(identity, bank, preview.confirmation);
    assert.equal(result.replayed, false);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_public"), 50);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_secret"), 50);
    const publicColumns = database.prepare("PRAGMA table_info(skct_question_public)").all().map((row) => row.name);
    assert.equal(publicColumns.some((name) => /answer|correct|explanation/u.test(String(name))), false);
    assert.equal(database.prepare("SELECT status FROM skct_content_releases").get()?.status, "active");
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM admin_audit_logs WHERE action = 'skct_bank_activated'"), 1);

    database.prepare("DELETE FROM backup_snapshots").run();
    const replay = await contractActivate(identity, bank, preview.confirmation);
    assert.equal(replay.replayed, true);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM admin_audit_logs WHERE action = 'skct_bank_activated'"), 1);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("invalid release hash and audit failure cannot publish an active partial bank", async () => {
  const bank = syntheticSkctBank();
  await assert.rejects(
    contractPreview({ ...bank, releaseSha256: "0".repeat(64) }),
    /release SHA가 본문과 일치/u,
  );

  const withoutBackup = databaseAt0559();
  useDatabase(withoutBackup);
  try {
    const preview = await contractPreview(bank);
    await assert.rejects(
      contractActivate(identity, bank, preview.confirmation),
      /admin-6 full backup/u,
    );
  } finally {
    withoutBackup.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }

  const database = databaseAt0559();
  addActivationBackup(database);
  database.exec(`
    CREATE TRIGGER reject_skct_activation_audit
    BEFORE INSERT ON admin_audit_logs
    WHEN NEW.action = 'skct_bank_activated'
    BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END
  `);
  useDatabase(database);
  try {
    const preview = await contractPreview(bank);
    await assert.rejects(
      contractActivate(identity, bank, preview.confirmation),
      /forced audit failure/u,
    );
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_content_releases"), 0);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_public"), 0);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_secret"), 0);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("bank preview rejects remote, traversal, and unverifiable asset references", async () => {
  const bank = syntheticSkctBank() as Record<string, unknown>;
  const question = (bank.questions as Array<Record<string, unknown>>).find((item) => Array.isArray(item.assets) && item.assets.length > 0);
  assert.ok(question);
  for (const asset of [
    { path: "https://example.invalid/question.svg", sha256: "a".repeat(64), bytes: 10 },
    { path: "assets/../secret.svg", sha256: "a".repeat(64), bytes: 10 },
    { path: "assets/P01/question.svg", sha256: "bad", bytes: 10 },
    { path: "assets/P01/question.svg", sha256: "a".repeat(64), bytes: 0 },
  ]) {
    const invalid = structuredClone(bank);
    const target = (invalid.questions as Array<Record<string, unknown>>).find((item) => item.questionUid === question.questionUid);
    assert.ok(target);
    target.assets = [asset];
    delete invalid.releaseSha256;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(invalid)));
    invalid.releaseSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await assert.rejects(contractPreview(invalid), /asset/u);
  }
});

test("synthetic provenance has a stable source fingerprint and rejects corrupt source hashes", async () => {
  const bank = syntheticSkctBank();
  assert.equal(bank.questions.length, 50);
  assert.equal(bank.questions[0].provenance.question.sourceRefs[0].sourceSha256,
    "14713968619eb321a654a302f917ce6d3c9f527b56f77a2236a2669e2d69434d");
  assert.equal(bank.source.mdSha256,
    "14713968619eb321a654a302f917ce6d3c9f527b56f77a2236a2669e2d69434d");
  const corruptProvenance = structuredClone(bank);
  corruptProvenance.questions[0].provenance.question.sourceRefs[0].sourceSha256 = "bad";
  await assert.rejects(
    contractPreview(await releaseVariant(corruptProvenance, "corrupt-provenance")),
    /source SHA/u,
  );
  const corruptManifest = structuredClone(bank);
  corruptManifest.source.recoveryManifestSha256 = "bad";
  await assert.rejects(
    contractPreview(await releaseVariant(corruptManifest, "corrupt-manifest")),
    /recoveryManifestSha256/u,
  );
});

test("concurrent identical activation converges on one release and one atomic audit", async () => {
  const bank = syntheticSkctBank();
  const preview = await contractPreview(bank);
  const database = databaseAt0559();
  addActivationBackup(database);
  useDatabase(database);
  try {
    const results = await Promise.all([
      contractActivate(identity, bank, preview.confirmation),
      contractActivate(identity, bank, preview.confirmation),
    ]);
    assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_content_releases WHERE status = 'active'"), 1);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM admin_audit_logs WHERE action = 'skct_bank_activated'"), 1);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("backup deletion, expiry, or invalidation at batch boundary leaves activation state unchanged", async (context) => {
  const bank = syntheticSkctBank() as Record<string, unknown>;
  const originalPreview = await contractPreview(bank);
  for (const invalidation of ["delete", "expire", "invalidate"] as const) {
    await context.test(invalidation, async () => {
      const database = databaseAt0559();
      addActivationBackup(database);
      const beforeNextBatch = useDatabase(database);
      try {
        await contractActivate(identity, bank, originalPreview.confirmation);
        const replacement = await releaseVariant(bank, invalidation);
        const replacementPreview = await contractPreview(replacement);
        beforeNextBatch(() => {
          if (invalidation === "delete") {
            database.prepare("DELETE FROM backup_snapshots WHERE id = 'skct-activation-backup'").run();
          } else if (invalidation === "expire") {
            database.prepare("UPDATE backup_snapshots SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = 'skct-activation-backup'").run();
          } else {
            database.prepare("UPDATE backup_snapshots SET checksum = '', status = 'failed' WHERE id = 'skct-activation-backup'").run();
          }
        });
        await assert.rejects(
          contractActivate(identity, replacement, replacementPreview.confirmation),
          /활성화 후 검증에 실패/u,
        );
        assert.deepEqual(
          database.prepare("SELECT id, status FROM skct_content_releases ORDER BY id").all()
            .map((row) => ({ id: row.id, status: row.status })),
          [{ id: String(bank.releaseId), status: "active" }],
        );
        assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_public"), 50);
        assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_secret"), 50);
        assert.equal(scalar(database, "SELECT COUNT(*) value FROM admin_audit_logs WHERE action = 'skct_bank_activated'"), 1);
      } finally {
        database.close();
        globalThis.__BAEUMZIP_ENV__ = undefined;
      }
    });
  }
});

test("one activation reference time keeps the backup guard stable across the 24-hour edge", async () => {
  const bank = syntheticSkctBank() as Record<string, unknown>;
  const preview = await contractPreview(bank);
  const database = databaseAt0559();
  addActivationBackup(database);
  const base = sqliteD1(database);
  globalThis.__BAEUMZIP_ENV__ = { DB: base as unknown as D1Database };
  try {
    await contractActivate(identity, bank, preview.confirmation);
    database.prepare("DELETE FROM backup_snapshots").run();
    database.prepare(`
      INSERT INTO backup_snapshots (
        id, backup_type, status, schema_version, app_version, included_data,
        counts, checksum, payload, byte_size, created_by_hash, created_at, error_message
      ) VALUES ('boundary-backup', 'full', 'completed', 'admin-6', 'test', '[]',
        '{}', ?, '{}', 2, 'admin-test-hash', ?, '')
    `).run("b".repeat(64), new Date(Date.now() - 24 * 60 * 60 * 1_000 + 800).toISOString());
    const replacement = await releaseVariant(bank, "clock-boundary");
    const replacementPreview = await contractPreview(replacement);
    const delayed = {
      ...base,
      async batch(statements: Array<{ execute: () => unknown }>) {
        database.exec("BEGIN");
        try {
          const results = [];
          for (let index = 0; index < statements.length; index += 1) {
            results.push(statements[index].execute());
            if (index === 0) {
              const end = Date.now() + 1_000;
              while (Date.now() < end) { /* cross the backup's 24-hour edge */ }
            }
          }
          database.exec("COMMIT");
          return results;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      },
    };
    globalThis.__BAEUMZIP_ENV__ = { DB: delayed as unknown as D1Database };
    const result = await contractActivate(identity, replacement, replacementPreview.confirmation);
    assert.equal(result.activated, true);
    assert.equal(result.replayed, false);
    assert.deepEqual(
      database.prepare("SELECT id, status FROM skct_content_releases ORDER BY id").all()
        .map((row) => ({ id: row.id, status: row.status })),
      [
        { id: String(bank.releaseId), status: "retired" },
        { id: String(replacement.releaseId), status: "active" },
      ],
    );
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_public"), 100);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_secret"), 100);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM admin_audit_logs WHERE action = 'skct_bank_activated'"), 2);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("private newly authored 300 source is the required activation fixture", async () => {
  assert.ok(actualBankPath && existsSync(actualBankPath),
    "SKCT_GROUP_ACTIVATION_BANK must point to the private authored-new300 JSON; synthetic coverage does not verify the actual source");
  const bank = JSON.parse(readFileSync(actualBankPath, "utf8"));
  const preview = await previewSkctBankActivation(bank);
  assert.equal(bank.schema, "baeumzip.skct-group-bank.v2");
  assert.equal(bank.dataset, "SKCT newly authored practice 300");
  assert.equal(preview.eligibleCount, 300);
  assert.equal(preview.quarantineCount, 0);
  assert.equal(preview.assetCount, 20);
  assert.equal(preview.releaseSha256, "a0376997fa366a36ff66df2cc426aac3195c486360a4b8f9815938d77e95f28f");
  assert.deepEqual(preview.areas, { 언어이해: 60, 자료해석: 60, 창의수리: 60, 언어추리: 60, 수열추리: 60 });
  const database = databaseAt0559();
  addActivationBackup(database);
  useDatabase(database);
  try {
    const result = await activateSkctBank(identity, bank, preview.confirmation);
    assert.equal(result.activated, true);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_public"), 300);
    assert.equal(scalar(database, "SELECT COUNT(*) value FROM skct_question_secret"), 300);
    const counts = database.prepare("SELECT normalized_count,eligible_count,quarantine_count FROM skct_content_releases WHERE id=?")
      .get(bank.releaseId) as Record<string, number>;
    assert.deepEqual([counts.normalized_count, counts.eligible_count, counts.quarantine_count], [300, 300, 0]);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("legacy schema and 509 dataset cannot be newly activated", async () => {
  const synthetic = syntheticSkctBank();
  const syntheticPreview = await contractPreview(synthetic);
  await assert.rejects(previewSkctBankActivation(synthetic), /신규 작성 SKCT 300/u);
  await assert.rejects(activateSkctBank(identity, synthetic, syntheticPreview.confirmation), /신규 작성 SKCT 300/u);
  const bank = syntheticSkctBank() as Record<string, unknown>;
  bank.dataset = "Conductor/SKCT 509";
  delete bank.releaseSha256;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(bank)));
  bank.releaseSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const preview = await contractPreview(bank);
  await assert.rejects(previewSkctBankActivation(bank), /신규 작성 SKCT 300/u);
  await assert.rejects(activateSkctBank(identity, bank, preview.confirmation), /신규 작성 SKCT 300/u);
});
