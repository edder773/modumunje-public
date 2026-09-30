import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CatalogPageShell from "../apps/frontend/src/features/study/components/catalog/catalog-page-shell";
import {
  acceptsCurrentResponse,
  currentForSelection,
} from "../apps/frontend/src/features/group-exams/group-exam-current-state";
import {
  confirmsGroupSettingsReadback,
  GROUP_EXAM_AREAS,
  groupSettingsDraft,
  groupSettingsSubmission,
} from "../apps/frontend/src/features/group-exams/group-exam-settings";

test("group navigation and pages use the same server feature flag", () => {
  const hidden = renderToStaticMarkup(<CatalogPageShell displayName="회원" signInPath="/login"
    signOutPath="/logout" isAuthenticated adminAccess={false} groupExamAccess={false}><p>본문</p></CatalogPageShell>);
  const shown = renderToStaticMarkup(<CatalogPageShell displayName="회원" signInPath="/login"
    signOutPath="/logout" isAuthenticated adminAccess groupExamAccess><p>본문</p></CatalogPageShell>);
  assert.doesNotMatch(hidden, /href="\/groups"/u);
  assert.match(shown, /href="\/groups"/u);
  for (const file of ["apps/frontend/app/groups/page.tsx", "apps/frontend/app/groups/invite/[token]/page.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /SKCT_GROUP_SERVICE_ENABLED !== "1"/u);
    assert.match(source, /notFound\(\)/u);
  }
});

test("mutation retry keys survive a successful API response until refresh confirms it", () => {
  const source = readFileSync("apps/frontend/src/features/group-exams/group-exam-client.tsx", "utf8");
  const userMutation = source.slice(source.indexOf("async function mutate("), source.indexOf("const selected ="));
  for (const mutation of [userMutation]) {
    const setAt = mutation.indexOf("retryKeys.current.set(signature, mutationKey)");
    const apiAt = mutation.indexOf("await api(");
    const refreshAt = mutation.indexOf("await refresh()");
    const deleteAt = mutation.indexOf("retryKeys.current.delete(signature)");
    assert.ok(setAt >= 0 && setAt < apiAt, "retry key must be recorded before the request");
    assert.ok(apiAt < refreshAt && refreshAt < deleteAt, "retry key must remain through follow-up refresh");
  }
  assert.doesNotMatch(source, /idempotencyKey:\s*operationId\("(?:quota-grant|start|schedule)"\)/u);
  const adminSource = readFileSync("apps/frontend/src/features/admin/components/admin-group-exams-section.tsx", "utf8");
  assert.match(adminSource, /"quota-grant"/u);
  assert.match(source, /mutate\("run-start",\s*\{\s*groupId,\s*mode:\s*"immediate"/u);
  assert.doesNotMatch(source, /mode:\s*"scheduled"/u);
  const runner=readFileSync("apps/frontend/src/features/group-exams/group-exam-runner-client.tsx","utf8");
  assert.match(runner,/idempotencyKey/);assert.match(runner,/putQueue\(item\)/);assert.match(runner,/claimQueue\(item[.]queueId/);
});

test("current question is bound to the selected group and its recent run", () => {
  const groupACurrent = {
    groupId: "group-a",
    runId: "run-a",
    payload: { run: { id: "run-a" }, question: { position: 2 } },
  };
  assert.equal(currentForSelection(groupACurrent, "group-a", "run-a"), groupACurrent.payload);
  assert.equal(currentForSelection(groupACurrent, "group-b", "run-b"), null,
    "group A current must not suppress group B due polling or render under group B");
  assert.equal(currentForSelection(groupACurrent, "group-a", "run-a-next"), null,
    "a completed run must not suppress the next scheduled run in the same group");

  assert.equal(acceptsCurrentResponse({
    requestGroupId: "group-a",
    responseRunId: "run-a",
    requestSequence: 3,
    selectedGroupId: "group-b",
    selectedRecentRunId: "run-b",
    latestSequence: 4,
  }), false, "a late group A response must not overwrite group B state");
  assert.equal(acceptsCurrentResponse({
    requestGroupId: "group-b",
    responseRunId: "run-b",
    requestSequence: 4,
    selectedGroupId: "group-b",
    selectedRecentRunId: "run-b",
    latestSequence: 4,
  }), true);
});

test("scheduled creation UI is removed and the dedicated exam route owns questions", () => {
  const source = readFileSync("apps/frontend/src/features/group-exams/group-exam-client.tsx", "utf8");
  assert.doesNotMatch(source,/scheduledAt|datetime-local|ScheduledStatus/u);
  assert.doesNotMatch(source,/CurrentQuestion/u);
  assert.match(source,/\/groups\/exams\//u);
});

test("group settings submission requires exact persisted readback and solo start stays enabled", () => {
  const areaSeconds = Object.fromEntries(GROUP_EXAM_AREAS.map((area, index) => [area, String(index + 31)])) as
    Record<(typeof GROUP_EXAM_AREAS)[number], string>;
  const submitted = groupSettingsSubmission({ revision: 4 }, { memberLimit: "2", areaSeconds });
  const stored = {
    revision: 5,
    member_limit: 2,
    settings_json: JSON.stringify(submitted.settings),
  };
  assert.equal(confirmsGroupSettingsReadback(stored, submitted), true);
  assert.equal(confirmsGroupSettingsReadback({ ...stored, revision: 4 }, submitted), false);
  assert.equal(confirmsGroupSettingsReadback({ ...stored, settings_json: "{}" }, submitted), false);
  assert.deepEqual(groupSettingsDraft({ member_limit: 9, settings_json: "{}" }, submitted), {
    memberLimit: "2",
    repeatPolicy: "allow", advanceTimePolicy: "carry_remaining",
    areaSeconds,
  });

  const source = readFileSync("apps/frontend/src/features/group-exams/group-exam-client.tsx", "utf8");
  assert.match(source, /successNotice: "그룹 설정을 저장했습니다[.]"/u);
  assert.match(source, /const confirmed = confirmsGroupSettingsReadback\(latest, attempt[.]submission\)/u);
  assert.match(source, /mutationAccepted \|\| !\(error instanceof GroupApiError\) [?:] "unconfirmed" [?:] "rejected"/u);
  assert.match(source, /서버가 설정 저장 요청을 거절했습니다/u);
  assert.match(source, /selectedIdRef[.]current === groupId/u);
  assert.match(source, /const selectGroup[\s\S]+setDetail\(null\);[\s\S]+setMembers\(\[\]\);/u);
  assert.match(source, /<OwnerControls key=\{selectedId\}/u);
  assert.match(source, /<form onSubmit=\{async \(event\) => \{\s*event[.]preventDefault\(\);/u);
  assert.match(source, /if \(settingsRequestPending[.]current\) return;\s*settingsRequestPending[.]current = true;/u);
  assert.match(source, /pending \?\? \{\s*idempotencyKey: operationId\("settings-update"\)/u);
  assert.match(source, /onPendingChange\(attempt\)/u);
  assert.match(source, /idempotencyKey: attempt[.]idempotencyKey/u);
  assert.match(source, /value=\{draft[.]memberLimit\}/u);
  assert.doesNotMatch(source, /name="memberLimit"[^>]+defaultValue=/u);
  assert.match(source, /pending \? "같은 값 다시 저장" : "설정 저장"/u);
  assert.match(source, /보류된 저장 취소/u);
  assert.match(source, /members[.]length === 0/u);
  assert.doesNotMatch(source, /members[.]length < 2/u);
});

test("degraded presence, gated strict repeat policy, and result accessibility stay explicit", () => {
  const source = readFileSync("apps/frontend/src/features/group-exams/group-exam-client.tsx", "utf8");
  assert.match(source, /기기 네트워크 \{deviceOnline \? "연결됨" : "끊김"\} · 서버 상태/u);
  assert.match(source, /presenceHealth[.]status !== "fresh" \? "확인 불가"/u);
  assert.match(source, /memberPresence === "online" \? "접속 중" : memberPresence === "recent" \? "최근 접속" : "오프라인"/u);
  const renderer = readFileSync("apps/frontend/src/features/group-exams/group-exam-question-renderer.tsx", "utf8");
  assert.match(renderer, /question[.]asset_refs_snapshot_json/u);
  assert.ok(renderer.includes('/^assets\\/[A-Za-z0-9._/-]+[.]svg$/u'));
  assert.match(renderer, /path[.]includes\("[.][.]"\)/u);
  assert.match(source, /이전 문항 재등장<select value=\{draft[.]repeatPolicy\}/u);
  assert.match(source, /<caption className="sr-only">그룹 SKCT 참가자 순위와 정답 및 오답 수<\/caption>/u);
  assert.match(source, /due = finishLobbyPoll/u);
  assert.doesNotMatch(source, /사이트 연결 온라인|사이트 연결 오프라인/u);
});
