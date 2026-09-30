import { authorizeAdminRequest, authorizePrefetchedLearner, isAdminRequest, learnerUserHash, normalizedEmail, verifyUserMutationRequest } from "@backend/common/auth/admin-auth";
import { metricPhase } from "@backend/common/observability/d1-metrics";
import { publicSiteSettingsFromRows } from "@backend/modules/study/study-site-settings-cache";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";
import { readBoundedJsonBody } from "@shared/http/bounded-json-body.mjs";
import { protectSkctQuestionAssets } from "@backend/modules/private-diagrams/private-diagrams.service";
import { appendPracticeBatch, commitCheckpoint, commitMutation, finishPractice, insertAttempt,
  listAdminItems, readAccount, readAdminOverview, readConcurrentStart, readHome, readMutation, readOwnedSnapshot, readRecords, readStart,
  type Row, type Snapshot } from "./skct-personal.repository";

import { SKCT_MOCK_QUESTION_COUNT, SKCT_MOCK_UNITS } from "@shared/study/skct-personal-exam";
import { initialFullMock, fullMockState, fullMockExpired, commitFullMockStep } from "./skct-personal-full-mock";

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
    fullMock: fullMockState(attempt),
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
      const {accountRow,records,statistics}=await readRecords(key,before);
      const authorization=deniedLearner(email,key,accountRow);
      if (!authorization.ok) return authorization.response;
      const page = records.slice(0,100);
      const last = page.at(-1);
      return json({ records: page, statistics, nextCursor: records.length > 100 && last ? JSON.stringify([last.started_at,last.id]) : null });
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
  const fullMock = body.mode === "mock" && body.unitId === "ALL";
  const fresh = body.fresh === true || fullMock;
  if ((!unit(body.unitId) && !fullMock) || !["practice", "mock"].includes(String(body.mode)))
    return invalidAfterAuthorization(email,key,"단원과 학습 방식을 확인해 주세요.");
  const mode = body.mode as "practice" | "mock";
  const requestId = fresh ? text(body.operationId) : null;
  if (fresh && (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)))
    return invalidAfterAuthorization(email,key,"시작 요청 식별자를 확인해 주세요.");
  const singlePractice = mode === "practice" && body.practiceFlowVersion === 3;
  const count = fullMock ? SKCT_MOCK_QUESTION_COUNT : mode === "practice" ? singlePractice ? 1 : 5 : 10;
  const {accountRow,siteRows,existing,release,selected}=await readStart(key,fullMock ? "U01" : String(body.unitId),mode,count,fullMock);
  const authorization=deniedLearner(email,key,accountRow);
  if (!authorization.ok) return authorization.response;
  const maintenance=maintenanceResponse(request,siteRows);
  if (maintenance) return maintenance;
  if (requestId) {
    const replay = await readOwnedSnapshot(requestId,key);
    if (replay.snapshot.attempt) {
      const previous = replay.snapshot.attempt;
      if (previous.mode !== mode || previous.unit_id !== (fullMock ? "U01" : body.unitId)
        || Boolean(previous.full_mock_json) !== fullMock) return fail("시작 요청 식별자가 다른 구성에 사용되었습니다.",409);
      return json({ attempt: attemptPayload(replay.snapshot), resumed: false, replayed: true });
    }
  }
  if (existing && !fresh) {
    const resumed=await readOwnedSnapshot(existing.id,key);
    return json({ attempt: attemptPayload(resumed.snapshot), resumed: true });
  }
  if (!release) return fail("문항 검증이 완료되기 전입니다.", 503);
  if (selected.length !== count || new Set(selected.map(row => row.source_item_id)).size !== count) return fail("문항 구성을 확인할 수 없습니다.", 503);
  if (fullMock && SKCT_MOCK_UNITS.some(id => selected.filter(row => (row as unknown as Row).unit_id === id).length !== 20))
    return fail("전체 영역의 문항 구성을 확인할 수 없습니다.",503);
  const id = requestId ?? crypto.randomUUID();
  try {
    const snapshot=await insertAttempt(id, key, release.id, fullMock ? "U01" : String(body.unitId), mode, selected,
      requestId ? { requestId, ...(fullMock ? { fullMockJson: JSON.stringify(initialFullMock()) } : {}) } : undefined);
    return json({ attempt: attemptPayload(snapshot), resumed: false }, 201);
  }
  catch {
    const concurrent=requestId ? (await readOwnedSnapshot(requestId,key)).snapshot : await readConcurrentStart(key,String(body.unitId),mode);
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
  const appendCount = body.practiceFlowVersion === 3 ? 1 : 5;
  const {accountRow,siteRows,snapshot,appendSelection}=await readMutation(key,id,action === "append",appendCount);
  const authorization=deniedLearner(email,key,accountRow);
  if (!authorization.ok) return authorization.response;
  const maintenance=maintenanceResponse(request,siteRows);
  if (maintenance) return maintenance;
  const attempt=snapshot.attempt;
  if (!attempt) return fail("학습 기록을 찾을 수 없습니다.", 404);
  const position = integer(body.position, 1, Number.MAX_SAFE_INTEGER);
  const choice = integer(body.choiceIndex, 1, 5);
  const opDigest = digest({ action, position, choice,
    ...(action === "answer" && [2,3].includes(Number(body.practiceFlowVersion)) ? { practiceFlowVersion: body.practiceFlowVersion } : {}),
    ...(action === "checkpoint" ? { activePosition: body.activePosition, answers: body.answers, times: body.times } : {}) });
  if (attempt.last_operation_id === operationId) {
    if (attempt.last_operation_digest !== opDigest) return fail("요청 식별자가 다른 답안에 사용되었습니다.", 409);
    return json({ attempt: attemptPayload(snapshot), replayed: true });
  }
  if (attempt.status !== "in_progress" || attempt.revision !== revision) return fail("다른 화면에서 학습 상태가 바뀌었습니다. 새로고침해 주세요.", 409);
  const fullMock = fullMockState(attempt);
  if (fullMock) {
    if (["advance","sync-exam","submit"].includes(action) || action === "checkpoint" && fullMockExpired(fullMock,Date.now())) {
      if (action === "advance" && position !== attempt.active_position) return fail("현재 문항만 넘길 수 있습니다.",409);
      const result = await commitFullMockStep(attempt,{ action: action === "checkpoint" ? "sync-exam" : action as "advance" | "sync-exam" | "submit",
        choice, operationId, operationDigest: opDigest });
      if (!result.committed) return fail("다른 화면에서 시험 상태가 바뀌었습니다.",409);
      return json({ attempt: attemptPayload(result.snapshot) });
    }
    if (action !== "checkpoint") return fail("실전형 모의고사는 현재 문항에서 순서대로 진행합니다.",409);
    if (fullMock.phase !== "answering") return fail("다음 영역이 시작되면 답안을 저장할 수 있습니다.",409);
  }
  if (action === "append" && attempt.mode === "practice") {
    const { items } = snapshot;
    if (!items.length || items.some(item => !item.finalized_at)) return fail("현재 연습 문항을 먼저 확인해 주세요.");
    const lastPosition = items.at(-1)!.position;
    const selected = appendSelection;
    if (selected.length !== appendCount || new Set(selected.map(row => row.source_item_id)).size !== appendCount)
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
    if (!Array.isArray(body.answers) || !Array.isArray(body.times) || body.answers.length > snapshot.items.length || body.times.length > snapshot.items.length)
      return fail("저장할 답안 형식을 확인해 주세요.");
    const { items } = snapshot;
    const validPositions = new Set(items.map(item => item.position));
    const activePosition = fullMock && body.activePosition === null ? attempt.active_position : body.activePosition === null ? null : integer(body.activePosition,1,items.length);
    if (activePosition === null && body.activePosition !== null || activePosition !== null && !validPositions.has(activePosition))
      return fail("문항 위치를 확인해 주세요.");
    const answers = body.answers.map(value => value && typeof value === "object" && !Array.isArray(value)
      ? { position: integer((value as Row).position,1,items.length), choiceIndex: integer((value as Row).choiceIndex,1,5) } : null);
    const times = body.times.map(value => value && typeof value === "object" && !Array.isArray(value)
      ? { position: integer((value as Row).position,1,items.length), seconds: integer((value as Row).seconds,0,30) } : null);
    if (answers.some(row => !row || row.position === null || row.choiceIndex === null || !validPositions.has(row.position))
      || times.some(row => !row || row.position === null || row.seconds === null || !validPositions.has(row.position))
      || new Set(answers.map(row => row?.position)).size !== answers.length
      || new Set(times.map(row => row?.position)).size !== times.length
      || times.reduce((sum,row) => sum + Number(row?.seconds ?? 0),0) > 30) return fail("저장할 답안과 시간을 확인해 주세요.");
    if (fullMock && (activePosition !== attempt.active_position || answers.some(row => row?.position !== attempt.active_position)
      || times.some(row => row?.position !== attempt.active_position))) return fail("넘긴 문항의 답안은 바꿀 수 없습니다.",409);
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
    continuousPractice: [2,3].includes(Number(body.practiceFlowVersion)) });
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
