import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import sitemap from "../apps/frontend/app/sitemap";

test("main sitemap uses active content revisions and evidenced editorial dates in one D1 batch", async () => {
  const db=openCanonicalTestDatabase(process.cwd());
  const previous=globalThis.__BAEUMZIP_ENV__;
  const d1=sqliteD1(db);
  globalThis.__BAEUMZIP_ENV__={ DB: d1 as unknown as D1Database };
  try {
    db.prepare(`INSERT INTO theories(title,category,exam_scope,updated_at,active)
      VALUES('sample','데이터 모델링의 이해','both','2026-10-01 02:00:00',1)`).run();
    db.prepare(`INSERT INTO theories(title,category,exam_scope,updated_at,active)
      VALUES('inactive','데이터 모델링의 이해','SQLD','2030-01-01 00:00:00',0)`).run();
    db.prepare(`INSERT INTO sw_theories(id,subject_group_id,subject_id,category,topic,title,updated_at,active)
      VALUES(99,'group','subject','sample','sample','sample','2026-10-03 03:00:00',1)`).run();
    const before=d1.roundTrips;
    const entries=await sitemap();
    assert.equal(d1.roundTrips-before,1);
    const byPath=new Map(entries.map(entry => [new URL(entry.url).pathname,entry]));
    assert.ok(entries.length>10);
    assert.ok(entries.every(entry => typeof entry.lastModified === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(entry.lastModified)));
    assert.equal(byPath.get("/learn/sql/sqld/theories")?.lastModified,"2026-10-01");
    assert.equal(byPath.get("/learn/sql/sqlp/theories")?.lastModified,"2026-10-01");
    assert.equal(byPath.get("/learn/software-major/theories")?.lastModified,"2026-10-03");
    assert.equal(byPath.get("/")?.lastModified,"2026-09-29");
    assert.equal(byPath.get("/guides/sqld")?.lastModified,"2026-09-29");
    assert.equal(byPath.get("/guides/sqlp")?.lastModified,"2026-09-21");
    assert.equal(byPath.get("/privacy")?.lastModified,"2026-09-30");
    assert.ok(byPath.has("/learn/big-data-analysis/bae-practical/home"));
    assert.ok(!byPath.has("/learn/skct-personal"));
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__=previous; }
});
