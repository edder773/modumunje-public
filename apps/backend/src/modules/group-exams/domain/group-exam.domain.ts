export const SKCT_AREAS = [
  "언어이해",
  "자료해석",
  "창의수리",
  "언어추리",
  "수열추리",
] as const;

export { APPROVED_SKCT_NEW300_GROUP_RELEASE } from "@shared/group-exams/approved-release";
import { APPROVED_SKCT_NEW300_GROUP_RELEASE } from "@shared/group-exams/approved-release";

export function approvedSkctNew300Release(release: Record<string, unknown> | null) {
  return release?.id === APPROVED_SKCT_NEW300_GROUP_RELEASE.id
    && release?.schema_version === APPROVED_SKCT_NEW300_GROUP_RELEASE.schema
    && release?.release_sha256 === APPROVED_SKCT_NEW300_GROUP_RELEASE.sha256
    && release?.status === "active";
}

export type SkctArea = (typeof SKCT_AREAS)[number];

export type GroupExamSettings = {
  areaSeconds: Record<SkctArea, number>;
  autoNext: true;
  repeatPolicy: "allow" | "forbid";
  advanceTimePolicy?: "carry_remaining" | "reset_to_base";
};

export type SelectableQuestion = {
  uid: string;
  area: SkctArea;
  dependencyGroupId: string | null;
};

export function orderQuestionsByArea<T extends { area: SkctArea }>(questions: readonly T[]) {
  const rank=new Map(SKCT_AREAS.map((area,index)=>[area,index]));
  return questions.map((question,index)=>({question,index})).sort((left,right)=>(rank.get(left.question.area)??SKCT_AREAS.length)-(rank.get(right.question.area)??SKCT_AREAS.length)||left.index-right.index).map(({question})=>question);
}

export type TimelineQuestion = {
  area: SkctArea;
  timeLimitSeconds: number;
};

export const DEFAULT_GROUP_QUESTION_COUNT = 15;
export const GROUP_MEMBER_LIMIT_MIN = 2;
export const GROUP_MEMBER_LIMIT_MAX = 50;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
export const SCHEDULE_ACTIVATION_GRACE_MS = 15 * 60_000;
export const STARTER_LEASE_MS = 30_000;
export const FINALIZER_LEASE_MS = 30_000;

export const DEFAULT_GROUP_EXAM_SETTINGS: GroupExamSettings = {
  areaSeconds: {
    언어이해: 45,
    자료해석: 45,
    창의수리: 45,
    언어추리: 45,
    수열추리: 45,
  },
  autoNext: true,
  repeatPolicy: "allow",
};

export class GroupExamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new GroupExamError(400, `${label} 값을 확인해 주세요.`, "GROUP_SETTING_INVALID");
  }
  return number;
}

export function parseGroupExamSettings(value: unknown): GroupExamSettings {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const seconds = record.areaSeconds && typeof record.areaSeconds === "object" && !Array.isArray(record.areaSeconds)
    ? record.areaSeconds as Record<string, unknown>
    : {};
  return {
    areaSeconds: Object.fromEntries(SKCT_AREAS.map((area) => [
      area,
      boundedInteger(seconds[area] ?? DEFAULT_GROUP_EXAM_SETTINGS.areaSeconds[area], 1, 3600, `${area} 제한시간`),
    ])) as Record<SkctArea, number>,
    autoNext: true,
    repeatPolicy: record.repeatPolicy === "forbid" ? "forbid" : "allow",
    ...(record.advanceTimePolicy ? { advanceTimePolicy: record.advanceTimePolicy === "reset_to_base" ? "reset_to_base" as const : "carry_remaining" as const } : {}),
  };
}

export function parseStoredGroupExamSettings(value: unknown): GroupExamSettings {
  try {
    return parseGroupExamSettings(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return DEFAULT_GROUP_EXAM_SETTINGS;
  }
}

export function validateMemberLimit(value: unknown) {
  return boundedInteger(value, GROUP_MEMBER_LIMIT_MIN, GROUP_MEMBER_LIMIT_MAX, "그룹 정원");
}

export function validateQuestionCount(value: unknown) {
  return boundedInteger(value, 1, 500, "문제 수");
}

export function publicGroupName(value: unknown, label = "그룹 공개 이름") {
  const name = String(value ?? "").trim().replaceAll(/\s+/gu, " ").slice(0, 40);
  if (name.length < 2 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(name)) {
    throw new GroupExamError(400, `${label}은 이메일이 아닌 2~40자 이름으로 입력해 주세요.`, "GROUP_PUBLIC_NAME_INVALID");
  }
  return name;
}

export function groupName(value: unknown) {
  const name = String(value ?? "").trim().replaceAll(/\s+/gu, " ").slice(0, 80);
  if (name.length < 2) {
    throw new GroupExamError(400, "그룹 이름은 2자 이상 입력해 주세요.", "GROUP_NAME_INVALID");
  }
  return name;
}

export function kstDateKey(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new GroupExamError(400, "날짜를 확인해 주세요.", "GROUP_DATE_INVALID");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function nextKstMidnight(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new GroupExamError(400, "날짜를 확인해 주세요.", "GROUP_DATE_INVALID");
  const shifted = new Date(date.getTime() + 9 * 60 * 60_000);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1,
  ) - 9 * 60 * 60_000).toISOString();
}

export function minutePrecisionInstant(value: unknown, now = Date.now()) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime()) || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) {
    throw new GroupExamError(400, "예약 시각은 분 단위 UTC 시각으로 입력해 주세요.", "GROUP_SCHEDULE_INVALID");
  }
  if (date.getTime() <= now) {
    throw new GroupExamError(409, "예약 시각은 현재 이후여야 합니다.", "GROUP_SCHEDULE_PAST");
  }
  return date;
}

async function seededOrder(seed: string, value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${seed}:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function selectQuestionBundles(
  questions: readonly SelectableQuestion[],
  count: number,
  seed: string,
) {
  validateQuestionCount(count);
  const bundles = new Map<string, SelectableQuestion[]>();
  for (const question of questions) {
    const key = question.dependencyGroupId ? `dependency:${question.dependencyGroupId}` : `single:${question.uid}`;
    const bundle = bundles.get(key) ?? [];
    bundle.push(question);
    bundles.set(key, bundle);
  }
  const ordered = await Promise.all([...bundles.entries()]
    .map(async ([key, bundle]) => ({
      key,
      questions: [...bundle].sort((left, right) => left.uid.localeCompare(right.uid)),
      order: await seededOrder(seed, key),
    })));
  ordered.sort((left, right) => left.order.localeCompare(right.order) || left.key.localeCompare(right.key));

  const reachable = new Map<number, number[]>([[0, []]]);
  ordered.forEach((bundle, bundleIndex) => {
    for (const [total, selected] of [...reachable.entries()].sort(([left], [right]) => right - left)) {
      const next = total + bundle.questions.length;
      if (next <= count && !reachable.has(next)) reachable.set(next, [...selected, bundleIndex]);
    }
  });
  const selectedBundles = reachable.get(count);
  if (!selectedBundles) {
    throw new GroupExamError(
      409,
      `검증된 공통자료 묶음을 보존하면서 ${count}문항을 정확히 구성할 수 없습니다.`,
      "GROUP_QUESTION_SELECTION_UNAVAILABLE",
    );
  }
  return selectedBundles.flatMap((index) => ordered[index].questions);
}

export async function selectRunQuestionBundles(
  questions: readonly SelectableQuestion[], count: number, seed: string,
) {
  if (count !== 50) return selectQuestionBundles(questions, count, seed);
  const owners = new Map<string, SkctArea>();
  for (const question of questions) {
    if (!question.dependencyGroupId) continue;
    const owner = owners.get(question.dependencyGroupId);
    if (owner && owner !== question.area) {
      throw new GroupExamError(409, "영역을 가로지르는 공통자료 묶음이 있어 50문항을 구성할 수 없습니다.",
        "GROUP_QUESTION_SELECTION_UNAVAILABLE");
    }
    owners.set(question.dependencyGroupId, question.area);
  }
  const selected = await Promise.all(SKCT_AREAS.map((area) =>
    selectQuestionBundles(questions.filter((question) => question.area === area), 10, `${seed}:${area}`)));
  return selected.flat();
}

export function buildQuestionTimeline(
  questions: readonly TimelineQuestion[],
  startedAt: Date,
) {
  let cursor = startedAt.getTime();
  const items = questions.map((question, position) => {
    const opensAt = new Date(cursor);
    cursor += question.timeLimitSeconds * 1_000;
    return {
      position,
      opensAt: opensAt.toISOString(),
      deadlineAt: new Date(cursor).toISOString(),
    };
  });
  return { items, finalDeadlineAt: new Date(cursor).toISOString() };
}

export function currentQuestionPosition(
  questions: readonly { position: number; opensAt: string | null; deadlineAt: string | null }[],
  now: number,
) {
  return questions.find((question) => (
    question.opensAt !== null
    && question.deadlineAt !== null
    && Date.parse(question.opensAt) <= now
    && now < Date.parse(question.deadlineAt)
  ))?.position ?? null;
}

export function competitionRanks<T extends { score: number }>(rows: readonly T[]) {
  const sorted = [...rows].sort((left, right) => right.score - left.score);
  let previousScore: number | null = null;
  let previousRank = 0;
  return sorted.map((row, index) => {
    const rank = row.score === previousScore ? previousRank : index + 1;
    previousScore = row.score;
    previousRank = rank;
    return { ...row, rank };
  });
}
