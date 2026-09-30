export const GROUP_EXAM_AREAS = [
  "언어이해",
  "자료해석",
  "창의수리",
  "언어추리",
  "수열추리",
] as const;

type AnyRecord = Record<string, unknown>;

export type GroupSettingsSubmission = {
  expectedRevision: number;
  memberLimit: number;
  settings: { areaSeconds: Record<(typeof GROUP_EXAM_AREAS)[number], number>; repeatPolicy?: "allow" | "forbid"; advanceTimePolicy?: "carry_remaining" | "reset_to_base" };
};

export type GroupSettingsDraft = {
  memberLimit: string;
  repeatPolicy?: "allow" | "forbid";
  advanceTimePolicy?: "carry_remaining" | "reset_to_base";
  areaSeconds: Record<(typeof GROUP_EXAM_AREAS)[number], string>;
};

function record(value: unknown): AnyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AnyRecord;
}

export function storedSettings(detail: AnyRecord): AnyRecord {
  try { return record(typeof detail.settings_json === "string" ? JSON.parse(detail.settings_json) : detail.settings_json); } catch { return {}; }
}

export function storedAreaSeconds(detail: AnyRecord) {
  try {
    const settings = typeof detail.settings_json === "string"
      ? record(JSON.parse(detail.settings_json))
      : record(detail.settings_json);
    return record(settings.areaSeconds);
  } catch {
    return {};
  }
}

export function groupSettingsDraft(
  detail: AnyRecord,
  pending?: GroupSettingsSubmission,
): GroupSettingsDraft {
  const stored = storedAreaSeconds(detail);
  const areaSeconds = {} as GroupSettingsDraft["areaSeconds"];
  for (const area of GROUP_EXAM_AREAS) {
    areaSeconds[area] = String(pending?.settings.areaSeconds[area] ?? stored[area] ?? 45);
  }
  return {
    memberLimit: String(pending?.memberLimit ?? detail.member_limit ?? 2),
    repeatPolicy: pending?.settings.repeatPolicy ?? (storedSettings(detail).repeatPolicy === "forbid" ? "forbid" : "allow"),
    advanceTimePolicy: pending?.settings.advanceTimePolicy ?? (storedSettings(detail).advanceTimePolicy === "reset_to_base" ? "reset_to_base" : "carry_remaining"),
    areaSeconds,
  };
}

export function groupSettingsSubmission(detail: AnyRecord, draft: GroupSettingsDraft): GroupSettingsSubmission {
  const areaSeconds = {} as GroupSettingsSubmission["settings"]["areaSeconds"];
  for (const area of GROUP_EXAM_AREAS) areaSeconds[area] = Number(draft.areaSeconds[area]);
  return {
    expectedRevision: Number(detail.revision),
    memberLimit: Number(draft.memberLimit),
    settings: { areaSeconds, repeatPolicy: draft.repeatPolicy, advanceTimePolicy: draft.advanceTimePolicy },
  };
}

export function confirmsGroupSettingsReadback(detail: AnyRecord, submitted: GroupSettingsSubmission) {
  const seconds = storedAreaSeconds(detail);
  return Number(detail.revision) === submitted.expectedRevision + 1
    && Number(detail.member_limit) === submitted.memberLimit
    && (!submitted.settings.repeatPolicy || (storedSettings(detail).repeatPolicy ?? "allow") === submitted.settings.repeatPolicy)
    && (!submitted.settings.advanceTimePolicy || (storedSettings(detail).advanceTimePolicy ?? "carry_remaining") === submitted.settings.advanceTimePolicy)
    && GROUP_EXAM_AREAS.every((area) => Number(seconds[area]) === submitted.settings.areaSeconds[area]);
}
