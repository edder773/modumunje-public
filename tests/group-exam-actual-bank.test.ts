import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { POST } from "../apps/backend/src/modules/group-exams/group-exam.service";

const fixture = process.env.SKCT_GROUP_ACTUAL_BANK_DATABASE?.trim();
const origin = "https://example.test";
let requestSequence = 0;
function bankDigest(database: DatabaseSync) {
  return createHash("sha256").update(JSON.stringify(database.prepare("SELECT * FROM skct_question_public ORDER BY release_id, question_uid").all())).digest("hex");
}

async function post(email: string, body: Record<string, unknown>) {
  const response = await POST(new Request(`${origin}/api/group-exams`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-baeumzip-authenticated-user-email": email,
      "x-sql-study-user-request": "1",
    },
    body: JSON.stringify({ ...body, idempotencyKey: `historical-request-${++requestSequence}` }),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

for (const v2 of [false, true]) {
  test(`historical bank cannot start a new ${v2 ? "v2" : "v1"} group run`, { skip: !fixture }, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "skct-historical-bank-"));
    const databasePath = path.join(directory, "historical.sqlite");
    copyFileSync(fixture!, databasePath);
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    const previous = globalThis.__BAEUMZIP_ENV__;
    globalThis.__BAEUMZIP_ENV__ = {
      DB: sqliteD1(database) as unknown as D1Database,
      SKCT_GROUP_SERVICE_ENABLED: "1",
      SKCT_GROUP_V2_ENABLED: v2 ? "1" : "0",
      SKCT_GROUP_REPEAT_IDENTITY_VERIFIED: "1",
    };
    try {
      const active = database.prepare("SELECT id, schema_version, release_sha256 FROM skct_content_releases WHERE status='active'").get();
      assert.ok(active);
      const before = bankDigest(database);
      const created = await post("historical-owner@example.test", { action: "group-create", name: "과거 은행 시작 차단", publicName: "대표" });
      assert.equal(created.status, 201);
      const groupId = String((created.body.group as Record<string, unknown>).id);
      const quotaBefore = database.prepare("SELECT status FROM study_group_quota_slots WHERE group_id=?").get(groupId)?.status ?? null;
      const started = await post("historical-owner@example.test", { action: "run-start", groupId, mode: "immediate" });
      assert.equal(started.status, 503);
      assert.equal(started.body.code, "SKCT_RELEASE_UNAVAILABLE");
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM study_group_exam_runs WHERE group_id=?").get(groupId)?.n, 0);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM study_group_exam_question_public").get()?.n, 0);
      assert.equal(database.prepare("SELECT status FROM study_group_quota_slots WHERE group_id=?").get(groupId)?.status ?? null, quotaBefore);
      assert.equal(bankDigest(database), before);
    } finally {
      database.close();
      globalThis.__BAEUMZIP_ENV__ = previous;
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
