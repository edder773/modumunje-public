import { expect, test, type Page, type Route } from "@playwright/test";

type Attempt = { body: Record<string, unknown>; correlation: string };
const runId = "durable-run-v4";
const question = (position: number) => ({ position, source_question_uid: `q${position}`, area_code_snapshot: "언어이해", prompt_snapshot: `내구성 문항 ${position + 1}`, choices_snapshot_json: ["보기 A", "보기 B"], asset_refs_snapshot_json: [], answer_json: [], answer_revision: 0, deadline_at_utc: new Date(Date.now() + 120_000).toISOString() });
const current = (position = 0, revision = 0) => ({ serverNow: new Date().toISOString(), phase: "running", participantStatus: "in_progress", run: { id: runId, status: "running", questionCount: 3, contractVersion: 2 }, progress: { position, revision, deadlineAt: question(position).deadline_at_utc }, question: question(position), publicQuestionWindow: [question(position)] });

async function install(page: Page, onPost: (route: Route, attempt: Attempt) => Promise<void>) {
  await page.route("**/api/group-exams**", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "POST") return onPost(route, { body: request.postDataJSON() as Record<string, unknown>, correlation: request.headers()["x-request-id"] ?? "" });
    if (url.searchParams.get("scope") === "current") return route.fulfill({ status: 200, json: current() });
    return route.fulfill({ status: 404, json: { code: "UNEXPECTED_REQUEST" } });
  });
}

test("the deployed client replays an empty edge response once with the same operation binding", async ({ page }) => {
  const attempts: Attempt[] = [];
  await install(page, async (route, attempt) => {
    attempts.push(attempt);
    if (attempts.length === 1) return route.fulfill({ status: 500, body: "" });
    return route.fulfill({ status: 200, json: { saved: true, advanced: true, position: 1, progressRevision: 1, publicQuestionWindow: [question(1)] } });
  });
  await page.goto(`/groups/exams/${runId}`);
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "다음 문항" }).click();
  await expect(page.getByText("✓ 답안을 저장했습니다.")).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1].correlation).toBe(attempts[0].correlation);
  expect(attempts[1].body).toEqual(attempts[0].body);
  expect(String(attempts[0].body.idempotencyKey)).toMatch(/^question-advance:/u);
});

test("a failed transport keeps the exact queued operation across reload and never claims an unacknowledged save", async ({ page }) => {
  const attempts: Attempt[] = []; let recover = false;
  await install(page, async (route, attempt) => {
    attempts.push(attempt);
    if (!recover) return route.abort("failed");
    return route.fulfill({ status: 200, json: { saved: true, advanced: true, position: 1, progressRevision: 1, publicQuestionWindow: [question(1)] } });
  });
  await page.goto(`/groups/exams/${runId}`);
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "다음 문항" }).click();
  await expect(page.getByText("연결이 끊겨 저장 여부를 확인하지 못했습니다. 다시 시도해 주세요.")).toBeVisible();
  await expect(page.getByText("✓ 답안을 저장했습니다.")).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  recover = true;
  await page.reload();
  await expect(page.getByText("✓ 답안을 저장했습니다.")).toBeVisible();
  expect(attempts).toHaveLength(3);
  expect(attempts[2].body).toEqual(attempts[0].body);
  expect(attempts[2].correlation).not.toBe("");
  expect(attempts.map((item) => item.body.idempotencyKey)).toEqual([attempts[0].body.idempotencyKey, attempts[0].body.idempotencyKey, attempts[0].body.idempotencyKey]);
});

test("two tabs atomically keep the first queued operation and expose the losing draft", async ({ context, page }) => {
  const second = await context.newPage();
  const attempts: Attempt[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const onPost = async (route: Route, attempt: Attempt) => {
    attempts.push(attempt);
    await gate;
    await route.fulfill({ status: 200, json: { saved: true, advanced: true, position: 1, progressRevision: 1, publicQuestionWindow: [question(1)] } });
  };
  await install(page, onPost);
  await install(second, onPost);
  await Promise.all([page.goto(`/groups/exams/${runId}`), second.goto(`/groups/exams/${runId}`)]);
  await page.getByRole("radio").nth(0).check();
  await second.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "다음 문항" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  await second.getByRole("button", { name: "다음 문항" }).click();
  await expect(second.getByText(/다른 화면에서 답안을 변경했습니다/u)).toBeVisible();
  expect(attempts).toHaveLength(1);
  await expect(second.getByText("내구성 문항 1")).toBeVisible();
  release();
  await expect(page.getByText("✓ 답안을 저장했습니다.")).toBeVisible();
  await second.close();
});

test("an expired cross-tab lease is reclaimed once instead of leaving the runner stuck", async ({ page }) => {
  const attempts: Attempt[] = [];
  await install(page, async (route, attempt) => {
    attempts.push(attempt);
    await route.fulfill({ status: 200, json: { saved: true, advanced: true, position: 1, progressRevision: 1, deadlineAt: question(1).deadline_at_utc, publicQuestionWindow: [question(1)] } });
  });
  await page.goto(`/groups/exams/${runId}`);
  await expect(page.getByText("내구성 문항 1")).toBeVisible();
  await page.evaluate(async ({ runId: targetRun }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("modumunje-group-exam-v1", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction("mutations", "readwrite");
    tx.objectStore("mutations").put({
      queueId: `${targetRun}:0:question-advance`, runId: targetRun, idempotencyKey: "question-advance:lease-recovery",
      action: "question-advance", body: { action: "question-advance", runId: targetRun, position: 0, answers: [0], expectedAnswerRevision: 0, expectedProgressRevision: 0, idempotencyKey: "question-advance:lease-recovery" },
      payloadDigest: "lease-digest", createdAt: Date.now(), attemptCount: 1, state: "inflight", leaseOwner: "closed-tab", leaseUntil: Date.now() + 350,
    });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { runId });
  await page.reload();
  await expect(page.getByText("✓ 답안을 저장했습니다.")).toBeVisible({ timeout: 5_000 });
  expect(attempts).toHaveLength(1);
  expect(attempts[0].body.idempotencyKey).toBe("question-advance:lease-recovery");
});

test("a late progress conflict restores the authoritative server question and keeps the queued draft explicit", async ({ page }) => {
  let serverPosition = 0;
  await page.route("**/api/group-exams**", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "POST") { serverPosition = 1; return route.fulfill({ status: 409, json: { code: "GROUP_PROGRESS_CONFLICT", error: "진행 상태가 변경되었습니다." } }); }
    if (url.searchParams.get("scope") === "current") return route.fulfill({ status: 200, json: current(serverPosition, serverPosition) });
    return route.fulfill({ status: 404, json: { code: "UNEXPECTED_REQUEST" } });
  });
  await page.goto(`/groups/exams/${runId}`);
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "다음 문항" }).click();
  await expect(page.getByText("내구성 문항 2")).toBeVisible();
  await expect(page.getByText(/서버 문항으로 돌아왔습니다/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
});

test("the question deadline triggers one authoritative readback without a client mutation", async ({ page }) => {
  let reads = 0; let posts = 0;
  await page.route("**/api/group-exams**", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "POST") { posts += 1; return route.fulfill({ status: 500, json: { code: "UNEXPECTED_POST" } }); }
    if (url.searchParams.get("scope") === "current") {
      reads += 1; const position = reads === 1 ? 0 : 1;
      const body = current(position, position);
      body.serverNow = new Date().toISOString(); body.progress.deadlineAt = new Date(Date.now() + (position === 0 ? 350 : 120_000)).toISOString();
      body.question.deadline_at_utc = body.progress.deadlineAt;
      return route.fulfill({ status: 200, json: body });
    }
    return route.fulfill({ status: 404, json: { code: "UNEXPECTED_REQUEST" } });
  });
  await page.goto(`/groups/exams/${runId}`);
  await expect(page.getByText("내구성 문항 2")).toBeVisible({ timeout: 3_000 });
  expect(reads).toBeGreaterThanOrEqual(2); expect(posts).toBe(0);
});

test("a sealed legacy active run remains usable on the dedicated route", async ({ page }) => {
  const actions: string[] = [];
  await page.route("**/api/group-exams**", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "POST") { const body = request.postDataJSON() as Record<string, unknown>; actions.push(String(body.action)); return route.fulfill({ status: 200, json: { saved: true, revision: 1 } }); }
    if (url.searchParams.get("scope") === "current") return route.fulfill({ status: 200, json: { serverNow: new Date().toISOString(), phase: "running", participantStatus: "in_progress", run: { id: runId, status: "running", questionCount: 3 }, question: question(0), publicQuestionWindow: [] } });
    return route.fulfill({ status: 404, json: { code: "UNEXPECTED_REQUEST" } });
  });
  await page.goto(`/groups/exams/${runId}`);
  await expect(page.getByRole("button", { name: "답안 저장" })).toBeVisible();
  await expect(page.getByRole("button", { name: "응시 완료" })).toBeVisible();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "답안 저장" }).click();
  await expect(page.getByText("✓ 답안을 저장했습니다.")).toBeVisible();
  expect(actions).toEqual(["answer-save"]);
});

test("a delayed ACK cannot delete a newer operation at the same queue position", async ({ page }) => {
  await install(page, async route => route.fulfill({ status: 200, json: { saved: true } }));
  await page.goto(`/groups/exams/${runId}`);
  await expect(page.getByText("내구성 문항 1")).toBeVisible();
  await page.evaluate(async ({ runId: targetRun }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("modumunje-group-exam-v1", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(["mutations", "drafts"], "readwrite");
    tx.objectStore("mutations").put({ queueId: `${targetRun}:0:question-advance`, runId: targetRun, idempotencyKey: "question-advance:new", action: "question-advance", body: { action: "question-advance", runId: targetRun, position: 0, answers: [1] }, payloadDigest: "new-digest", createdAt: Date.now(), attemptCount: 0, state: "pending" });
    tx.objectStore("drafts").put({ key: `${targetRun}:0`, runId: targetRun, position: 0, answers: [1], updatedAt: Date.now() });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    const delayed = new BroadcastChannel(`group-exam:${targetRun}`);
    delayed.postMessage({ kind: "ack", queueId: `${targetRun}:0:question-advance`, idempotencyKey: "question-advance:old", payloadDigest: "old-digest" });
    window.setTimeout(() => delayed.close(), 100);
  }, { runId });
  await expect(page.getByText(/다른 화면에서 응시 상태가 변경되었습니다/u)).toBeVisible();
  const preserved = await page.evaluate(async ({ runId: targetRun }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("modumunje-group-exam-v1", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(["mutations", "drafts"], "readonly"); const mutation = tx.objectStore("mutations").get(`${targetRun}:0:question-advance`); const draft = tx.objectStore("drafts").get(`${targetRun}:0`);
    const result = await Promise.all([new Promise<Record<string, unknown>>((resolve, reject) => { mutation.onsuccess = () => resolve(mutation.result); mutation.onerror = () => reject(mutation.error); }), new Promise<Record<string, unknown>>((resolve, reject) => { draft.onsuccess = () => resolve(draft.result); draft.onerror = () => reject(draft.error); })]); db.close(); return result;
  }, { runId });
  expect(preserved[0].idempotencyKey).toBe("question-advance:new");
  expect(preserved[1].answers).toEqual([1]);
});

test("same-key response-loss replay adopts a newer authoritative server position", async ({ page }) => {
  let recover = false; let serverPosition = 0; const attempts: Attempt[] = [];
  await page.route("**/api/group-exams**", async route => {
    const request = route.request(); const url = new URL(request.url());
    if(request.method()==="POST"){
      attempts.push({body:request.postDataJSON() as Record<string,unknown>,correlation:request.headers()["x-request-id"]??""});
      if(!recover)return route.abort("failed");
      return route.fulfill({status:200,json:{saved:true,advanced:true,position:1,progressRevision:1,publicQuestionWindow:[question(1)]}});
    }
    if(url.searchParams.get("scope")==="current")return route.fulfill({status:200,json:current(serverPosition,serverPosition)});
    return route.fulfill({status:404,json:{code:"UNEXPECTED_REQUEST"}});
  });
  await page.goto(`/groups/exams/${runId}`);await page.getByRole("radio").first().check();await page.getByRole("button",{name:"다음 문항"}).click();
  await expect(page.getByText(/연결이 끊겨 저장 여부를 확인하지 못했습니다/u)).toBeVisible();
  serverPosition=2;recover=true;await page.reload();
  await expect(page.getByText("내구성 문항 3")).toBeVisible();
  await expect(page.getByText("내구성 문항 2")).toHaveCount(0);
  expect(attempts).toHaveLength(3);expect(attempts[2].body).toEqual(attempts[0].body);
});

test("a replay ACK followed by current 503 never claims stale saved state and can recover manually", async ({ page }) => {
  let postAck=false;let allowReadback=false;
  await page.route("**/api/group-exams**",async route=>{const request=route.request();const url=new URL(request.url());if(request.method()==="POST"){postAck=true;return route.fulfill({status:200,json:{saved:true,advanced:true,position:1,progressRevision:1,publicQuestionWindow:[question(1)]}});}if(url.searchParams.get("scope")==="current"){if(postAck&&!allowReadback)return route.fulfill({status:503,json:{code:"READBACK_UNAVAILABLE"}});return route.fulfill({status:200,json:current(allowReadback?2:0,allowReadback?2:0)});}return route.fulfill({status:404,json:{code:"UNEXPECTED"}});});
  await page.goto(`/groups/exams/${runId}`);await expect(page.getByText("내구성 문항 1")).toBeVisible();
  await page.evaluate(async({runId:targetRun})=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("modumunje-group-exam-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const tx=db.transaction("mutations","readwrite");tx.objectStore("mutations").put({queueId:`${targetRun}:0:question-advance`,runId:targetRun,idempotencyKey:"question-advance:replay-readback",action:"question-advance",body:{action:"question-advance",runId:targetRun,position:0,answers:[0],expectedAnswerRevision:0,expectedProgressRevision:0,idempotencyKey:"question-advance:replay-readback"},payloadDigest:"replay-readback",createdAt:Date.now(),attemptCount:1,state:"pending"});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();},{runId});
  await page.reload();await expect(page.getByText(/답안은 저장됐지만 다음 문항을 불러오지 못했습니다/u).first()).toBeVisible();
  await expect(page.getByText("내구성 문항 2")).toHaveCount(0);await expect(page.getByText("✓ 답안을 저장했습니다.")).toHaveCount(0);await expect(page.getByRole("button",{name:"다시 시도"})).toHaveCount(0);
  allowReadback=true;await page.getByRole("button",{name:"다시 불러오기"}).click();await expect(page.getByText("내구성 문항 3")).toBeVisible();
});

test("legacy save ACK plus current 503 remains acknowledged and offers readback retry", async ({ page }) => {
  let postAck=false;let allowReadback=false;
  await page.route("**/api/group-exams**",async route=>{const request=route.request();const url=new URL(request.url());if(request.method()==="POST"){postAck=true;return route.fulfill({status:200,json:{saved:true,revision:1}});}if(url.searchParams.get("scope")==="current"){if(postAck&&!allowReadback)return route.fulfill({status:503,json:{code:"READBACK_UNAVAILABLE"}});const position=allowReadback?1:0;return route.fulfill({status:200,json:{serverNow:new Date().toISOString(),phase:"running",participantStatus:"in_progress",run:{id:runId,status:"running",questionCount:3},question:question(position),publicQuestionWindow:[]}});}return route.fulfill({status:404,json:{code:"UNEXPECTED"}});});
  await page.goto(`/groups/exams/${runId}`);await page.getByRole("radio").first().check();await page.getByRole("button",{name:"답안 저장"}).click();
  await expect(page.getByText(/답안은 저장됐지만 다음 문항을 불러오지 못했습니다/u).first()).toBeVisible();await expect(page.getByText(/연결이 끊겨 저장 여부를 확인하지 못했습니다/u)).toHaveCount(0);await expect(page.getByRole("button",{name:"다시 시도"})).toHaveCount(0);
  allowReadback=true;await page.getByRole("button",{name:"다시 불러오기"}).click();await expect(page.getByText("내구성 문항 2")).toBeVisible();
});

test("matching broadcast ACK with failed readback exits syncing and remains manually recoverable",async({page})=>{
  let failReadback=false;await install(page,async route=>route.fulfill({status:200,json:{saved:true}}));await page.goto(`/groups/exams/${runId}`);await expect(page.getByText("내구성 문항 1")).toBeVisible();
  await page.unroute("**/api/group-exams**");await page.route("**/api/group-exams**",async route=>{const url=new URL(route.request().url());if(url.searchParams.get("scope")==="current"&&failReadback)return route.fulfill({status:503,json:{code:"READBACK_UNAVAILABLE"}});return route.fulfill({status:200,json:current(1,1)});});
  await page.evaluate(async({runId:targetRun})=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("modumunje-group-exam-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const tx=db.transaction("mutations","readwrite");tx.objectStore("mutations").put({queueId:`${targetRun}:0:question-advance`,runId:targetRun,idempotencyKey:"question-advance:broadcast",action:"question-advance",body:{},payloadDigest:"broadcast-digest",createdAt:Date.now(),attemptCount:1,state:"inflight"});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();},{runId});
  failReadback=true;await page.evaluate(({runId:targetRun})=>{const channel=new BroadcastChannel(`group-exam:${targetRun}`);channel.postMessage({kind:"ack",queueId:`${targetRun}:0:question-advance`,idempotencyKey:"question-advance:broadcast",payloadDigest:"broadcast-digest"});setTimeout(()=>channel.close(),100);},{runId});
  await expect(page.getByText(/답안은 저장됐지만 다음 문항을 불러오지 못했습니다/u).first()).toBeVisible();await expect(page.getByText("내구성 문항 1")).toHaveCount(0);failReadback=false;await page.getByRole("button",{name:"다시 불러오기"}).click();await expect(page.getByText("내구성 문항 2")).toBeVisible();
});

test("countdown zero, focus, and visibility share one in-flight current read",async({page})=>{
  let reads=0;let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/api/group-exams**",async route=>{const url=new URL(route.request().url());if(url.searchParams.get("scope")!=="current")return route.fulfill({status:404,json:{code:"UNEXPECTED"}});reads+=1;if(reads===1)return route.fulfill({status:200,json:{serverNow:new Date().toISOString(),phase:"countdown",countdownEndsAt:new Date(Date.now()-10).toISOString(),participantStatus:"rostered",run:{id:runId,status:"running",questionCount:3,contractVersion:2},progress:{revision:0,position:0},question:null,publicQuestionWindow:[]}});await gate;return route.fulfill({status:200,json:current()});});
  await page.goto(`/groups/exams/${runId}`);await expect(page.getByRole("heading",{name:"시험 시작"})).toBeVisible();await expect.poll(()=>reads).toBe(2);for(let index=0;index<4;index++)await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.waitForTimeout(800);expect(reads).toBe(2);release();await expect(page.getByText("내구성 문항 1")).toBeVisible();
});

test("a persisted conflict restores explicit retry controls without automatic POST loop",async({page})=>{
  let posts=0;await install(page,async route=>{posts+=1;await route.fulfill({status:500,json:{code:"UNEXPECTED_POST"}});});await page.goto(`/groups/exams/${runId}`);await expect(page.getByText("내구성 문항 1")).toBeVisible();
  await page.evaluate(async({runId:targetRun})=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("modumunje-group-exam-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const tx=db.transaction(["mutations","drafts"],"readwrite");tx.objectStore("mutations").put({queueId:`${targetRun}:0:question-advance`,runId:targetRun,idempotencyKey:"question-advance:conflict",action:"question-advance",body:{},payloadDigest:"conflict",createdAt:Date.now(),attemptCount:1,state:"conflict"});tx.objectStore("drafts").put({key:`${targetRun}:0`,runId:targetRun,position:0,answers:[1],updatedAt:Date.now()});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();},{runId});
  await page.reload();await expect(page.getByText(/다른 화면에서 응시 상태가 변경되었습니다/u)).toBeVisible();await expect(page.getByRole("button",{name:"다시 시도"})).toBeVisible();await expect(page.getByRole("button",{name:/최신 문항으로 돌아가기/u})).toBeVisible();await page.waitForTimeout(1_500);expect(posts).toBe(0);
});


test("the numeric timer keeps ticking while a slow next-question acknowledgement is pending",async({page})=>{
 let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});let posted=false;
 await install(page,async(route)=>{posted=true;await gate;await route.fulfill({json:{saved:true,advanced:true,position:1,progressRevision:1,deadlineAt:question(1).deadline_at_utc,publicQuestionWindow:[question(1)]}});});
 await page.goto(`/groups/exams/${runId}`);await page.getByRole("radio").first().check();
 const timer=page.getByText("현재 문항 남은 시간",{exact:true}).locator('..').locator('strong');const before=await timer.innerText();await page.getByRole("button",{name:"다음 문항"}).click();await expect.poll(()=>posted).toBe(true);await expect(timer).toHaveText(/^\d{2}:\d{2}$/);await expect.poll(()=>timer.innerText()).not.toBe(before);await expect(page.getByText("확인 중",{exact:true})).toHaveCount(0);
 release();await expect(page.getByRole("heading",{name:"2번 문항",exact:true})).toBeVisible();await expect(timer).toHaveText(/^\d{2}:\d{2}$/);
});
