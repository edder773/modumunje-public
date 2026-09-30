import { expect, test } from "@playwright/test";

type Json = Record<string, unknown>;
const runId = "run-v4-ui";
const groupId = "group-v4-ui";
const questions = [0, 1, 2].map((position) => ({
  position, source_question_uid: `question-${position}`,
  area_code_snapshot: position < 2 ? "언어이해" : "자료해석",
  prompt_snapshot: `공개 문항 ${position + 1}`,
  choices_snapshot_json: ["첫 번째 보기", "두 번째 보기"], asset_refs_snapshot_json: [],
  answer_json: [], answer_revision: 0, deadline_at_utc: new Date(Date.now() + 120_000).toISOString(),
}));

test("a successful start opens the countdown and reveals the next question only after server acknowledgement", async ({ page }, testInfo) => {
  let started = false, running = false, progressRevision = 0, currentGets = 0, lobbyGets = 0, groupsBeforeStart = 0;
  const posts: Json[] = [];
  let releaseAdvance: () => void = () => undefined;
  const advanceGate = new Promise<void>((resolve) => { releaseAdvance = resolve; });
  await page.addInitScript(() => {
    const target = window as typeof window & { __groupExamMetrics?: unknown[] };
    target.__groupExamMetrics = [];
    window.addEventListener("group-exam-interaction", (event) => target.__groupExamMetrics?.push((event as CustomEvent).detail));
  });
  await page.route("**/api/group-exams**", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Json;
      if (body.action === "run-start") { started = true; return route.fulfill({ status: 201, json: { run: { id: runId, groupId, status: "running", questionCount: 3 } } }); }
      if (body.action === "question-advance") { posts.push(body); await advanceGate; progressRevision += 1; return route.fulfill({ status: 200, json: { saved: true, advanced: true, position: 1, progressRevision, deadlineAt: questions[1].deadline_at_utc, publicQuestionWindow: [questions[1]] } }); }
      if (body.action === "presence-heartbeat") return route.fulfill({ status: 200, json: { serverNow: new Date().toISOString(), groupId,
        ...(body.includeSync === true ? { phase: started ? "running" : "idle", run: started ? { id: runId, status: "running" } : null,
          presence: [], stateVersion: `4:${started ? runId : "idle"}:0:${started ? "running" : "idle"}`, presenceVersion: "empty" } : { expiresInSeconds: 60 }) } });
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    const scope = url.searchParams.get("scope");
    if (scope === "lobby") lobbyGets += 1;
    if (scope === "groups" && !started) groupsBeforeStart += 1;
    if (scope === "lobby" || scope === "groups") return route.fulfill({ status: 200, json: { groups: [{ id: groupId, name: "UI 검증 그룹", recent_run_id: started ? runId : null, recent_run_status: started ? "running" : null }], ownedActiveCount: 1, capabilities: { personalProgress: true, strictRepeat: true },
      ...(scope === "lobby" ? { selectedGroupId: groupId,
        detail: { group: { id: groupId, name: "UI 검증 그룹", is_owner: true, revision: 4, active_members: 1, reserved_invites: 0, member_limit: 5, settings_json: "{}", lobby: { effectiveQuestionCount: 3, quotaRemaining: 1, quotaTotal: 1 } }, members: [{ membership_id: "self", public_name: "대표", is_owner: true }] },
        sync: { groupId, phase: started ? "running" : "idle", run: started ? { id: runId, status: "running" } : null, presence: [], stateVersion: `4:${started ? runId : "idle"}:0:${started ? "running" : "idle"}`, presenceVersion: "empty" } } : {}) } });
    if (scope === "group") return route.fulfill({ status: 200, json: { group: { id: groupId, name: "UI 검증 그룹", is_owner: true, revision: 4, active_members: 1, reserved_invites: 0, member_limit: 5, settings_json: "{}", lobby: { effectiveQuestionCount: 3, quotaRemaining: 1, quotaTotal: 1 } }, members: [{ membership_id: "self", public_name: "대표", is_owner: true }] } });
    if (scope === "sync") return route.fulfill({ status: 200, json: { groupId, phase: started ? "running" : "idle", run: started ? { id: runId, status: "running" } : null, presence: [] } });
    if (scope === "current") {
      currentGets += 1;
      if (!running) { running = true; return route.fulfill({ status: 200, json: { serverNow: new Date().toISOString(), phase: "countdown", countdownEndsAt: new Date(Date.now() + 700).toISOString(), participantStatus: "rostered", run: { id: runId, status: "running", questionCount: 3, contractVersion: 2 }, progress: { revision: 0, position: 0 }, question: null, publicQuestionWindow: [] } }); }
      return route.fulfill({ status: 200, json: { serverNow: new Date().toISOString(), phase: "running", participantStatus: "in_progress", run: { id: runId, status: "running", questionCount: 3, contractVersion: 2 }, progress: { revision: progressRevision, position: progressRevision, deadlineAt: questions[progressRevision].deadline_at_utc }, question: questions[progressRevision], publicQuestionWindow: [questions[progressRevision]] } });
    }
    return route.fulfill({ status: 404, json: { code: "UNEXPECTED_REQUEST" } });
  });

  await page.goto("/groups");
  await expect.poll(() => lobbyGets).toBe(1);
  expect(groupsBeforeStart).toBe(0);
  await expect(page.getByText("공개 문항 1")).toHaveCount(0);
  await page.getByRole("button", { name: "시험 시작" }).click();
  await page.getByRole("button", { name: "지금 시작" }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/exams/${runId}$`, "u"));
  await expect(page.getByRole("heading", { name: "시험 시작" })).toBeVisible();
  await expect(page.getByText("공개 문항 1")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("그룹 선택")).toHaveCount(0);
  await expect(page.getByText("그룹 결과")).toHaveCount(0);
  await page.getByRole("radio").nth(1).check(); expect(posts).toHaveLength(0);
  const currentBeforeAdvance = currentGets;
  await page.getByRole("button", { name: "다음 문항" }).click();
  await expect(page.getByText("공개 문항 1")).toBeVisible();
  await expect(page.getByText("공개 문항 2")).toHaveCount(0);
  await expect(page.getByText("답안을 저장하고 있습니다…")).toBeVisible();
  await expect(page.getByRole("button", { name: "다음 문항" })).toBeDisabled();
  expect(posts).toHaveLength(1); expect(currentGets).toBe(currentBeforeAdvance);
  releaseAdvance(); await expect(page.getByText("✓ 답안을 저장했습니다.")).toBeVisible();
  await expect(page.getByText("공개 문항 2")).toBeVisible();
  await page.getByRole("radio").first().check();
  await expect(page.getByRole("radio").first()).toBeChecked();
  expect(currentGets).toBe(currentBeforeAdvance);
  const metrics = await page.evaluate(() => (window as typeof window & { __groupExamMetrics?: Array<{ kind: string; durationMs: number }> }).__groupExamMetrics ?? []);
  expect(metrics.some((item) => item.kind === "ack")).toBe(true);
  for (const [width, height, name] of [[320, 720, "320"], [390, 844, "390"], [1440, 1000, "1440"]] as const) {
    await page.setViewportSize({ width, height }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`group-exam-v4-${name}.png`), fullPage: true });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
