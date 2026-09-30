import {
  DEFAULT_EXAM_TYPE,
  isReleasedExamType,
  type ExamType,
} from "@shared/study/study-domain";
import type { Attempt } from "../components/study-screen-shared";
import { clientEventId } from "./client-event-id";
export { clientEventId } from "./client-event-id";

export type GuestLearningState = {
  version: 1;
  importId: string;
  selectedExam: ExamType;
  bookmarks: number[];
  // Identifies each addition so a remove-and-readd after an import snapshot
  // is distinct from the bookmark already submitted in that snapshot.
  bookmarkAddTokens?: Record<string, string>;
  recoveryError?: string;
  attempts: Attempt[];
  theoryProgress: Array<{
    theoryId: number;
    examType: ExamType;
    completed: boolean;
    updatedAt: string;
  }>;
};

export const GUEST_LEARNING_STORAGE_KEY = "baeumzip-guest-learning:v1";
export const GUEST_IMPORT_PENDING_KEY = "baeumzip-guest-import-pending:v1";
export const GUEST_IMPORT_RECEIPT_PREFIX = "baeumzip-guest-import-receipt:v1:";
const RECENT_SQL_PRACTICE_KEY = "baeumzip-recent-sql-practice:v1";
const MAX_RECENT_QUESTION_IDS = 100;

export function readRecentSqlPracticeQuestionIds(userKeyHash: string, examType: ExamType) {
  try {
    const raw = window.localStorage.getItem(`${RECENT_SQL_PRACTICE_KEY}:${userKeyHash}:${examType}`);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids)
      ? [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(-MAX_RECENT_QUESTION_IDS)
      : [];
  } catch {
    return [];
  }
}

export function writeRecentSqlPracticeQuestionIds(
  userKeyHash: string,
  examType: ExamType,
  ids: number[],
) {
  const recent = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
    .slice(-MAX_RECENT_QUESTION_IDS);
  window.localStorage.setItem(
    `${RECENT_SQL_PRACTICE_KEY}:${userKeyHash}:${examType}`,
    JSON.stringify(recent),
  );
}

function emptyGuestLearningState(): GuestLearningState {
  return {
    version: 1,
    importId: clientEventId(),
    selectedExam: DEFAULT_EXAM_TYPE,
    bookmarks: [],
    bookmarkAddTokens: {},
    attempts: [],
    theoryProgress: [],
  };
}

function subtractImportedSnapshot(current: GuestLearningState, submitted: GuestLearningState, nextImportId: string): GuestLearningState {
  const counts = new Map<string, number>();
  for (const attempt of submitted.attempts) {
    const key = `${attempt.id}:${JSON.stringify(attempt)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const attempts = current.attempts.filter(attempt => {
    const key = `${attempt.id}:${JSON.stringify(attempt)}`;
    const count = counts.get(key) ?? 0;
    if (!count) return true;
    counts.set(key, count - 1);
    return false;
  });
  const importedBookmarks = new Set(submitted.bookmarks);
  const bookmarks = current.bookmarks.filter(id => !importedBookmarks.has(id)
    || current.bookmarkAddTokens?.[String(id)] !== submitted.bookmarkAddTokens?.[String(id)]);
  const bookmarkAddTokens = Object.fromEntries(bookmarks.flatMap(id => {
    const token = current.bookmarkAddTokens?.[String(id)];
    return token ? [[String(id), token]] : [];
  }));
  const selectedExam = attempts.length || bookmarks.length || current.selectedExam !== submitted.selectedExam
    ? current.selectedExam : DEFAULT_EXAM_TYPE;
  return { ...current, importId: nextImportId, selectedExam, attempts, bookmarks, bookmarkAddTokens };
}

type GuestImportReceipt = { version: 1; snapshot: GuestLearningState; nextImportId: string };
function receiptFor(importId: string): GuestImportReceipt | null {
  const raw = window.localStorage.getItem(`${GUEST_IMPORT_RECEIPT_PREFIX}${importId}`);
  if (!raw) return null;
  const receipt = JSON.parse(raw) as GuestImportReceipt;
  if (receipt?.version !== 1 || receipt.snapshot?.importId !== importId
    || !/^[a-zA-Z0-9_-]{12,80}$/.test(receipt.nextImportId)
    || !Array.isArray(receipt.snapshot.attempts) || !Array.isArray(receipt.snapshot.bookmarks)) {
    throw new Error("Saved guest import receipt is invalid");
  }
  return receipt;
}

export function readGuestLearningState(): GuestLearningState {
  let current: GuestLearningState;
  try {
    const raw = window.localStorage.getItem(GUEST_LEARNING_STORAGE_KEY);
    if (!raw) return emptyGuestLearningState();
    const parsed = JSON.parse(raw) as Partial<GuestLearningState>;
    if (parsed.version !== 1 || !/^[a-zA-Z0-9_-]{12,80}$/.test(String(parsed.importId ?? ""))) {
      return emptyGuestLearningState();
    }
    current = {
      version: 1,
      importId: String(parsed.importId),
      selectedExam: isReleasedExamType(parsed.selectedExam)
        ? parsed.selectedExam
        : DEFAULT_EXAM_TYPE,
      bookmarks: [...new Set((parsed.bookmarks ?? []).map(Number).filter(Number.isInteger))],
      bookmarkAddTokens: Object.fromEntries(
        Object.entries(parsed.bookmarkAddTokens && typeof parsed.bookmarkAddTokens === "object"
          && !Array.isArray(parsed.bookmarkAddTokens) ? parsed.bookmarkAddTokens : {})
          .filter(([id, token]) => Number.isInteger(Number(id)) && typeof token === "string"
            && /^[a-zA-Z0-9_-]{12,80}$/.test(token)),
      ),
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      theoryProgress: [],
    };
  } catch {
    return emptyGuestLearningState();
  }
  // A receipt consumes only the accepted snapshot. Raw guest data is never
  // changed by the importer, so a concurrent tab's append remains available.
  const seen = new Set<string>();
  while (!seen.has(current.importId)) {
    seen.add(current.importId);
    let receipt: GuestImportReceipt | null;
    try {
      receipt = receiptFor(current.importId);
    } catch {
      return { ...current, recoveryError: "게스트 이관 영수증 오류가 있습니다. 이 브라우저의 원본 기록은 보존했습니다. 지원팀에 복구를 요청해 주세요." };
    }
    if (!receipt) break;
    current = subtractImportedSnapshot(current, receipt.snapshot, receipt.nextImportId);
  }
  return current;
}

export function writeGuestLearningState(state: GuestLearningState) {
  let previous: Partial<GuestLearningState> | null = null;
  try {
    const raw = window.localStorage.getItem(GUEST_LEARNING_STORAGE_KEY);
    previous = raw ? JSON.parse(raw) as Partial<GuestLearningState> : null;
  } catch { /* The write still reports localStorage errors to its caller. */ }
  const previousIds = new Set(Array.isArray(previous?.bookmarks) ? previous.bookmarks : []);
  const bookmarkAddTokens = Object.fromEntries(state.bookmarks.map(id => {
    const key = String(id);
    const existing = state.bookmarkAddTokens?.[key];
    const addedNow = !previousIds.has(id)
      || (previous?.importId !== state.importId && !existing);
    return [key, addedNow ? clientEventId() : existing ?? previous?.bookmarkAddTokens?.[key]];
  }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const persisted = { ...state };
  delete persisted.recoveryError;
  window.localStorage.setItem(GUEST_LEARNING_STORAGE_KEY,
    JSON.stringify({ ...persisted, bookmarkAddTokens, theoryProgress: [] }));
}

export function hasGuestLearningData(state: GuestLearningState) {
  return state.bookmarks.length > 0
    || state.attempts.length > 0
    || state.selectedExam !== DEFAULT_EXAM_TYPE;
}

export async function withSaveTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort("save-timeout"), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("저장 시간이 초과되었습니다.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

// The submitted snapshot survives reloads and lost responses. Never replace it
// while the server may have committed its import ID.
export function pendingGuestImportSnapshot(userKeyHash: string): GuestLearningState | null {
  const raw = window.localStorage.getItem(GUEST_IMPORT_PENDING_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { version: number; userKeyHash: string; snapshot: GuestLearningState };
  const snapshot = parsed?.snapshot;
  if (parsed?.version !== 1 || parsed.userKeyHash !== userKeyHash
    || snapshot?.version !== 1 || !/^[a-zA-Z0-9_-]{12,80}$/.test(snapshot.importId)
    || !Array.isArray(snapshot.bookmarks) || !Array.isArray(snapshot.attempts)) {
    throw new Error("Saved guest import snapshot is invalid or belongs to another account");
  }
  return snapshot;
}

export function stageGuestImportSnapshot(current: GuestLearningState, userKeyHash: string): GuestLearningState {
  const pending = pendingGuestImportSnapshot(userKeyHash);
  if (pending) return pending;
  const snapshot = structuredClone(current);
  window.localStorage.setItem(GUEST_IMPORT_PENDING_KEY, JSON.stringify({ version: 1, userKeyHash, snapshot }));
  return snapshot;
}

export function reconcileGuestImportSnapshot(submitted: GuestLearningState, userKeyHash: string): boolean {
  const pending = pendingGuestImportSnapshot(userKeyHash);
  if (!pending || JSON.stringify(pending) !== JSON.stringify(submitted)) return false;
  const key = `${GUEST_IMPORT_RECEIPT_PREFIX}${submitted.importId}`;
  const existing = receiptFor(submitted.importId);
  if (existing && JSON.stringify(existing.snapshot) !== JSON.stringify(submitted)) return false;
  if (!existing) {
    const receipt: GuestImportReceipt = { version: 1, snapshot: structuredClone(submitted), nextImportId: clientEventId() };
    // Persist the receipt before clearing pending. A lost response or reload
    // then replays the same request without consuming any newer guest edits.
    window.localStorage.setItem(key, JSON.stringify(receipt));
  }
  const rawPending = window.localStorage.getItem(GUEST_IMPORT_PENDING_KEY);
  if (rawPending) {
    const latest = pendingGuestImportSnapshot(userKeyHash);
    if (latest && JSON.stringify(latest) === JSON.stringify(submitted)
      && window.localStorage.getItem(GUEST_IMPORT_PENDING_KEY) === rawPending) {
      window.localStorage.removeItem(GUEST_IMPORT_PENDING_KEY);
    }
  }
  return true;
}
