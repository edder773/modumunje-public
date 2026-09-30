import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { activateSkctBank, previewSkctBankActivation } from "../../apps/backend/src/modules/admin/admin-skct-bank-use-cases";
import { APPROVED_SKCT_NEW300_GROUP_RELEASE } from "../../apps/backend/src/modules/group-exams/domain/group-exam.domain";
import { openCanonicalTestDatabase } from "./canonical-database.mjs";

export function readApprovedGroupBank() {
  const fixture = process.env.SKCT_GROUP_ACTIVATION_BANK?.trim();
  assert.ok(fixture && existsSync(fixture), "SKCT_GROUP_ACTIVATION_BANK must name the private approved new300 JSON");
  const bank = JSON.parse(readFileSync(fixture, "utf8")) as Record<string, unknown>;
  assert.equal(bank.schema, APPROVED_SKCT_NEW300_GROUP_RELEASE.schema);
  assert.equal(bank.releaseId, APPROVED_SKCT_NEW300_GROUP_RELEASE.id);
  assert.equal(bank.releaseSha256, APPROVED_SKCT_NEW300_GROUP_RELEASE.sha256);
  assert.equal((bank.questions as unknown[]).length, 300);
  return bank;
}

export async function activateApprovedGroupBank(database: ReturnType<typeof openCanonicalTestDatabase>) {
  assert.equal(database.prepare("SELECT migration_version FROM app_schema_state WHERE id=1").get()?.migration_version,
    "0564", "this shared fixture uses the current canonical schema and admin-9 full backup");
  const bank = readApprovedGroupBank();
  const preview = await previewSkctBankActivation(bank);
  assert.equal(preview.eligibleCount, 300);
  database.prepare(`INSERT INTO backup_snapshots
    (id,backup_type,status,schema_version,app_version,included_data,counts,checksum,payload,byte_size,created_by_hash,created_at,error_message)
    VALUES (?, 'full', 'completed', 'admin-9', 'test', '[]', '{}', ?, '{}', 2, 'test-admin', ?, '')`)
    .run(`new300-test-backup-${crypto.randomUUID()}`, "a".repeat(64), new Date().toISOString());
  const result = await activateSkctBank({ email: "admin@example.invalid", hash: "test-admin" }, bank, preview.confirmation);
  assert.equal(result.activated, true);
  return bank;
}
