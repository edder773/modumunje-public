import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdminSkctBankActivation from "../apps/frontend/src/features/admin/components/admin-skct-bank-activation";
import { previewSkctBankActivation } from "../apps/backend/src/modules/admin/admin-skct-bank-use-cases";
import { APPROVED_SKCT_NEW300_GROUP_RELEASE } from "../packages/shared/src/group-exams/approved-release";
import {
  EXPECTED_SKCT_RELEASE,
  isExpectedSkctRelease,
  parseSkctBankActivationResult,
  parseSkctBankPreview,
} from "../apps/frontend/src/features/admin/model/admin-skct-bank-activation";

const preview = {
  canActivate: true,
  releaseId: EXPECTED_SKCT_RELEASE.releaseId,
  releaseSha256: EXPECTED_SKCT_RELEASE.releaseSha256,
  eligibleCount: EXPECTED_SKCT_RELEASE.eligibleCount,
  quarantineCount: EXPECTED_SKCT_RELEASE.quarantineCount,
  assetCount: EXPECTED_SKCT_RELEASE.assetCount,
  areas: EXPECTED_SKCT_RELEASE.areas,
  confirmation: `ACTIVATE ${EXPECTED_SKCT_RELEASE.releaseId} ${EXPECTED_SKCT_RELEASE.releaseSha256}`,
};

test("admin SKCT activation surface exposes only the approved release and safe initial controls", () => {
  const html = renderToStaticMarkup(<AdminSkctBankActivation onNotice={() => undefined} />);
  assert.match(html, /그룹 SKCT 문제은행 활성화/u);
  assert.match(html, new RegExp(EXPECTED_SKCT_RELEASE.releaseId, "u"));
  assert.match(html, new RegExp(EXPECTED_SKCT_RELEASE.releaseSha256, "u"));
  assert.match(html, /type="file"/u);
  assert.match(html, /서버에서 검증하고 release 대조/u);
  assert.match(html, /300문항 · 5개 영역 각 60문항 · 도식 20개/u);
  assert.doesNotMatch(html, /correctAnswers|explanationMd|<pre/u);
});

test("preview and activation readback accept only internally consistent safe summaries", () => {
  const parsed = parseSkctBankPreview(preview);
  assert.equal(isExpectedSkctRelease(parsed), true);
  assert.equal(isExpectedSkctRelease({ ...parsed, releaseSha256: "0".repeat(64) }), false);
  assert.equal(isExpectedSkctRelease({ ...parsed, assetCount: 19 }), false);
  assert.equal(isExpectedSkctRelease({ ...parsed,
    releaseId: "skct-drive-current-draft-v2-verified50-20260920",
    releaseSha256: "8f737458bd2a8e588153158e1dd758a639946725bf352b02df1e6ce1e1d3259d",
    eligibleCount: 50, quarantineCount: 450,
    areas: { 언어이해: 10, 자료해석: 10, 창의수리: 10, 언어추리: 10, 수열추리: 10 },
  }), false);
  assert.deepEqual(parseSkctBankActivationResult({ ...preview, activated: true, replayed: false }), {
    ...preview,
    activated: true,
    replayed: false,
  });
  for (const invalid of [
    { ...preview, confirmation: "ACTIVATE another-release" },
    { ...preview, releaseSha256: "not-a-sha" },
    { ...preview, eligibleCount: 501 },
    { ...preview, assetCount: -1 },
    { ...preview, areas: { 언어이해: -1 } },
    { ...preview, activated: false, replayed: false },
    { ...preview, activated: true, replayed: "false" },
  ]) {
    const parse = "activated" in invalid ? parseSkctBankActivationResult : parseSkctBankPreview;
    assert.throws(() => parse(invalid));
  }
});

test("actual new300 server preview enables the admin release gate and old target remains blocked", async () => {
  const bankPath = process.env.SKCT_GROUP_ACTIVATION_BANK?.trim();
  assert.ok(bankPath && existsSync(bankPath),
    "SKCT_GROUP_ACTIVATION_BANK must point to the private approved new300 fixture");
  const bank = JSON.parse(readFileSync(bankPath, "utf8"));
  const serverPreview = await previewSkctBankActivation(bank);
  assert.equal(bank.schema, APPROVED_SKCT_NEW300_GROUP_RELEASE.schema);
  assert.equal(serverPreview.assetCount, APPROVED_SKCT_NEW300_GROUP_RELEASE.assetCount);
  assert.equal(isExpectedSkctRelease(parseSkctBankPreview(serverPreview)), true);
  const oldPreview = { ...serverPreview, releaseId: "skct-drive-current-draft-v2-verified50-20260920" };
  assert.equal(isExpectedSkctRelease(parseSkctBankPreview({
    ...oldPreview,
    confirmation: `ACTIVATE ${oldPreview.releaseId} ${oldPreview.releaseSha256}`,
  })), false);
});

test("file changes invalidate prior validation and mutation clicks share one client lock", () => {
  const source = readFileSync("apps/frontend/src/features/admin/components/admin-skct-bank-activation.tsx", "utf8");
  assert.match(source, /generation[.]current = version;\s*clearValidatedState\(\);\s*setBank\(null\)/u);
  assert.match(source, /if \(!bank \|\| requestLocked[.]current\) return/u);
  assert.match(source, /if \(!bank \|\| !preview \|\| !exactRelease \|\| !confirmed \|\| requestLocked[.]current\) return/u);
  assert.match(source, /confirmation: preview[.]confirmation/u);
  assert.match(source, /setPreview\(null\);\s*setResult\(null\);\s*setConfirmed\(false\)/u);
});
