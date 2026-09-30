import { authorizeAdminRequest, authorizePrefetchedLearner, isAdminRequest, learnerUserHash, normalizedEmail, verifyUserMutationRequest } from "@backend/common/auth/admin-auth";
import { metricPhase } from "@backend/common/observability/d1-metrics";
import { publicSiteSettingsFromRows } from "@backend/modules/study/study-site-settings-cache";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";
import { readBoundedJsonBody } from "@shared/http/bounded-json-body.mjs";
import { protectSkctQuestionAssets } from "@backend/modules/private-diagrams/private-diagrams.service";
import { appendPracticeBatch, commitCheckpoint, commitMutation, finishPractice, insertAttempt,
  listAdminItems, readAccount, readAdminOverview, readConcurrentStart, readHome, readMutation, readOwnedSnapshot, readRecords, readStart,
  type Row, type Snapshot } from "./skct-personal.repository";

const units = ["U01", "U02", "U03", "U04", "U05"] as const;
const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function json(data: unknown, status = 200) { return Response.json(data, { status, headers: noStore }); }
function fail(message: string, status = 400) { return json({ error: message }, status); }
function text(value: unknown, max = 100) { return typeof value === "string" && value.length > 0 && value.length <= max ? value : null; }
function unit(value: unknown): value is typeof units[number] { return units.includes(value as typeof units[number]); }
function integer(value: unknown, min: number, max: number) { return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null; }
function digest(value: unknown) { return JSON.stringify(value); }

function attemptPayload({ attempt, items, secretRows }: Snapshot) {
  if (!attempt) throw new Error("Missing SKCT personal attempt");
  const secrets = new Map(secretRows.map(row => [row.position, row]));
  const responseItems = items.map(item => {
    const secret = secrets.get(item.position);
    return {
      position: item.position, sourceItemId: item.source_item_id,
      question: protectSkctQuestionAssets(JSON.parse(item.public_json)),
      selectedIndex: item.selected_index, finalized: Boolean(item.finalized_at), elapsedSeconds: item.elapsed_seconds,
      ...(secret ? { feedback: { answerIndex: secret.answer_index, correct: item.selected_index === secret.answer_index,
        explanation: secret.explanation, distractorExplanations: JSON.parse(secret.distractor_explanations_json) } } : {}),
    };
  });
  return { id: attempt.id, releaseId: attempt.release_id, unitId: attempt.unit_id, mode: attempt.mode,
    status: attempt.status, revision: attempt.revision, activePosition: attempt.active_position,
    activeSince: attempt.active_since, lastOperationId: attempt.last_operation_id,
    startedAt: attempt.started_at, submittedAt: attempt.submitted_at, items: responseItems,
    correctCount: attempt.status === "submitted" ? responseItems.filter(item => item.feedback?.correct).length : null };
}
async function learnerIdentity(request: Request) {
  // Account and content D1 reads are measured separately; auth is local identity work.
  return metricPhase("auth",async () => {
    const email=normalizedEmail(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER));
    return { email, key: email ? await learnerUserHash(email) : null };
  });
}
function deniedLearner(email: string,key: string | null,row: Parameters<typeof authorizePrefetchedLearner>[2]) {
  return authorizePrefetchedLearner(email,key,row);
}
async function invalidAfterAuthorization(email: string,key: string,message: string,status=400) {
  const authorization=deniedLearner(email,key,await readAccount(key));
  return authorization.ok ? fail(message,status) : authorization.response;
}
function maintenanceResponse(request: Request,siteRows: Array<{key:string;value:string}>) {
  return publicSiteSettingsFromRows(siteRows).maintenanceMode && !isAdminRequest(request)
    ? fail("현재 유지보수 중입니다. 잠시 후 다시 이용해 주세요.",503) : null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "home";
    if (view === "admin" || view === "admin-items") {
      const admin = await authorizeAdminRequest(request);
      if (!admin.ok) return admin.response;
      if (view === "admin-items") {
        const cursor = integer(Number(url.searchParams.get("cursor") ?? 0),0,Number.MAX_SAFE_INTEGER);
        if (cursor === null) return fail("조회 위치를 확인해 주세요.");
        const entries = await listAdminItems(cursor);
        const page = entries.slice(0,100);
        return json({ items: page, nextCursor: entries.length > 100 ? page.at(-1)?.cursor : null });
      }
      const days = url.searchParams.get("days") ?? "30";
      if (!["30", "90", "all"].includes(days)) return fail("집계 기간을 확인해 주세요.");
      const since = days === "all" ? null : new Date(Date.now() - Number(days) * 86_400_000)
        .toISOString().slice(0,19).replace("T", " ");
      const { aggregates, audit } = await readAdminOverview(since);
      return json({ aggregates, audit, days });
    }
    const { email,key }=await learnerIdentity(request);
    if (!key) return fail("로그인이 필요합니다.",401);
    if (view === "home") {
      const {accountRow,release}=await readHome(key);
      const authorization=deniedLearner(email,key,accountRow);
      if (!authorization.ok) return authorization.response;
      return json({ available: Boolean(release),
        units: units.map((id, index) => ({ id, name: ["언어이해", "자료해석", "창의수리", "언어추리", "수열추리"][index] })) });
    }
    if (view === "records") {
      let before: [string, string] | null = null;
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        try {
          const value: unknown = JSON.parse(cursor);
          if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" ||
              !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value[0]) || typeof value[1] !== "string" ||
              value[1].length < 1 || value[1].length > 100)
            return invalidAfterAuthorization(email,key,"기록 조회 위치를 확인해 주세요.");
          before = value as [string, string];
        } catch { return invalidAfterAuthorization(email,key,"기록 조회 위치를 확인해 주세요."); }
      }
      const {accountRow,records}=await readRecords(key,before);
      const authorization=deniedLearner(email,key,accountRow);
      if (!authorization.ok) return authorization.response;
      const page = records.slice(0,100);
      const last = page.at(-1);
      return json({ records: page, nextCursor: records.length > 100 && last ? JSON.stringify([last.started_at,last.id]) : null });
    }
    if (view === "attempt") {
      const id = text(url.searchParams.get("id"));
      if (!id) return invalidAfterAuthorization(email,key,"시도 ID가 필요합니다.");
      const {accountRow,snapshot}=await readOwnedSnapshot(id,key);
      const authorization=deniedLearner(email,key,accountRow);
      if (!authorization.ok) return authorization.response;
      if (!snapshot.attempt) return fail("학습 기록을 찾을 수 없습니다.", 404);
      return json({ attempt: attemptPayload(snapshot) });
    }
    return invalidAfterAuthorization(email,key,"지원하지 않는 조회입니다.");
  } catch {
    return fail("SKCT 학습 데이터를 불러오지 못했습니다.", 503);
  }
}

async function start(request: Request,email: string,key: string, body: Row) {
  if (!unit(body.unitId) || !["practice", "mock"].includes(String(body.mode)))
    return invalidAfterAuthorization(email,key,"단원과 학습 방식을 확인해 주세요.");
  const mode = body.mode as "practice" | "mock";
  const count = mode === "practice" ? 5 : 10;
  const {accountRow,siteRows,existing,release,selected}=await readStart(key,String(body.unitId),mode,count);
  const authorization=deniedLearner(email,key,accountRow);
  if (!authorization.ok) return authorization.response;
  const maintenance=maintenanceResponse(request,siteRows);
  if (maintenance) return maintenance;
  if (existing) {
    const resumed=await readOwnedSnapshot(existing.id,key);
    return json({ attempt: attemptPayload(resumed.snapshot), resumed: true });
  }
  if (!release) return fail("문항 검증이 완료되기 전입니다.", 503);
  if (selected.length !== count || new Set(selected.map(row => row.source_item_id)).size !== count) return fail("문항 구성을 확인할 수 없습니다.", 503);
  const id = crypto.randomUUID();
  try {
    const snapshot=await insertAttempt(id, key, release.id, String(body.unitId), mode, selected);
    return json({ attempt: attemptPayload(snapshot), resumed: false }, 201);
  }
  catch {
    const concurrent=await readConcurrentStart(key,String(body.unitId),mode);
    if (concurrent.attempt) return json({ attempt: attemptPayload(concurrent), resumed: true });
    return fail("학습을 시작하지 못했습니다.", 503);
  }
}

async function mutate(request: Request,email: string,key: string, body: Row) {
  const action = text(body.action, 20);
  const id = text(body.attemptId);
  const operationId = text(body.operationId, 100);
  const revision = integer(body.revision, 0, Number.MAX_SAFE_INTEGER);
  if (!action || !id || !operationId || revision === null)
    return invalidAfterAuthorization(email,key,"요청 식별자와 버전을 확인해 주세요.");
  const {accountRow,siteRows,snapshot,appendSelection}=await readMutation(key,id,action === "append");
  const authorization=deniedLearner(email,key,accountRow);
  if (!authorization.ok) return authorization.response;
  const maintenance=maintenanceResponse(request,siteRows);
  if (maintenance) return maintenance;
  const attempt=snapshot.attempt;
  if (!attempt) return fail("학습 기록을 찾을 수 없습니다.", 404);
  const position = integer(body.position, 1, Number.MAX_SAFE_INTEGER);
  const choice = integer(body.choiceIndex, 1, 5);
  const opDigest = digest({ action, position, choice,
    ...(action === "answer" && body.practiceFlowVersion === 2 ? { practiceFlowVersion: 2 } : {}),
    ...(action === "checkpoint" ? { activePosition: body.activePosition, answers: body.answers, times: body.times } : {}) });
  if (attempt.last_operation_id === operationId) {
    if (attempt.last_operation_digest !== opDigest) return fail("요청 식별자가 다른 답안에 사용되었습니다.", 409);
    return json({ attempt: attemptPayload(snapshot), replayed: true });
  }
  if (attempt.status !== "in_progress" || attempt.revision !== revision) return fail("다른 화면에서 학습 상태가 바뀌었습니다. 새로고침해 주세요.", 409);
  if (action === "append" && attempt.mode === "practice") {
    const { items } = snapshot;
    if (!items.length || items.some(item => !item.finalized_at)) return fail("현재 연습 문항을 먼저 확인해 주세요.");
    const lastPosition = items.at(-1)!.position;
    const selected = appendSelection;
    if (selected.length !== 5 || new Set(selected.map(row => row.source_item_id)).size !== 5)
      return fail("다음 연습 문항을 준비하지 못했습니다.", 503);
    const result = await appendPracticeBatch(attempt,lastPosition,selected,operationId,opDigest);
    if (!result.committed) return fail("다른 화면에서 학습 상태가 바뀌었습니다. 새로고침해 주세요.", 409);
    return json({ attempt: attemptPayload(result.snapshot) });
  }
  if (action === "finish" && attempt.mode === "practice") {
    const result = await finishPractice(attempt,operationId,opDigest);
    if (!result.committed) return fail("다른 화면에서 학습 상태가 바뀌었습니다. 새로고침해 주세요.", 409);
    return json({ attempt: attemptPayload(result.snapshot) });
  }
  if (action === "checkpoint" && attempt.mode === "mock") {
    if (!Array.isArray(body.answers) || !Array.isArray(body.times) || body.answers.length > 10 || body.times.length > 10)
      return fail("저장할 답안 형식을 확인해 주세요.");
    const { items } = snapshot;
    const validPositions = new Set(items.map(item => item.position));
    const activePosition = body.activePosition === null ? null : integer(body.activePosition,1,10);
    if (activePosition === null && body.activePosition !== null || activePosition !== null && !validPositions.has(activePosition))
      return fail("문항 위치를 확인해 주세요.");
    const answers = body.answers.map(value => value && typeof value === "object" && !Array.isArray(value)
      ? { position: integer((value as Row).position,1,10), choiceIndex: integer((value as Row).choiceIndex,1,5) } : null);
    const times = body.times.map(value => value && typeof value === "object" && !Array.isArray(value)
      ? { position: integer((value as Row).position,1,10), seconds: integer((value as Row).seconds,0,30) } : null);
    if (answers.some(row => !row || row.position === null || row.choiceIndex === null || !validPositions.has(row.position))
      || times.some(row => !row || row.position === null || row.seconds === null || !validPositions.has(row.position))
      || new Set(answers.map(row => row?.position)).size !== answers.length
      || new Set(times.map(row => row?.position)).size !== times.length
      || times.reduce((sum,row) => sum + Number(row?.seconds ?? 0),0) > 30) return fail("저장할 답안과 시간을 확인해 주세요.");
    const result = await commitCheckpoint(attempt, { activePosition,
      answers: answers as Array<{ position: number; choiceIndex: number }>,
      times: times as Array<{ position: number; seconds: number }>, operationId, operationDigest: opDigest });
    if (!result.committed) return fail("다른 화면에서 학습 상태가 바뀌었습니다. 새로고침해 주세요.", 409);
    return json({ attempt: attemptPayload(result.snapshot) });
  }
  const validAction = (action === "focus" && position !== null) || action === "pause"
    || (action === "answer" && attempt.mode === "practice" && position !== null && choice !== null)
    || (action === "save" && attempt.mode === "mock" && position !== null && choice !== null)
    || (action === "submit" && attempt.mode === "mock");
  if (!validAction) return fail("요청한 학습 동작을 확인해 주세요.");
  const result = await commitMutation({ action: action as "focus" | "pause" | "answer" | "save" | "submit",
    key, id, revision, position, choice, operationId, operationDigest: opDigest, mode: attempt.mode,
    continuousPractice: body.practiceFlowVersion === 2 });
  if (!result.committed) return fail("다른 화면에서 학습 상태가 바뀌었습니다. 새로고침해 주세요.", 409);
  return json({ attempt: attemptPayload(result.snapshot) });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const mutationError = verifyUserMutationRequest(request);
    if (mutationError) return mutationError;
    const {email,key}=await learnerIdentity(request);
    if (!key) return fail("로그인이 필요합니다.",401);
    let body: Row;
    try { body=await readBoundedJsonBody(request, 8192) as Row; }
    catch { return invalidAfterAuthorization(email,key,"SKCT 학습 상태를 저장하지 못했습니다.",503); }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return invalidAfterAuthorization(email,key,"요청 형식을 확인해 주세요.");
    return body.action === "start" ? start(request,email,key,body) : mutate(request,email,key,body);
  } catch {
    return fail("SKCT 학습 상태를 저장하지 못했습니다.", 503);
  }
}
