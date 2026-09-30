import { APPROVED_SKCT_NEW300_GROUP_RELEASE } from "@shared/group-exams/approved-release";

type JsonRecord = Record<string, unknown>;

export const EXPECTED_SKCT_RELEASE = {
  releaseId: APPROVED_SKCT_NEW300_GROUP_RELEASE.id,
  releaseSha256: APPROVED_SKCT_NEW300_GROUP_RELEASE.sha256,
  eligibleCount: APPROVED_SKCT_NEW300_GROUP_RELEASE.eligibleCount,
  quarantineCount: APPROVED_SKCT_NEW300_GROUP_RELEASE.quarantineCount,
  assetCount: APPROVED_SKCT_NEW300_GROUP_RELEASE.assetCount,
  areas: APPROVED_SKCT_NEW300_GROUP_RELEASE.areas,
} as const;

export type SkctBankPreview = {
  canActivate: boolean;
  releaseId: string;
  releaseSha256: string;
  eligibleCount: number;
  quarantineCount: number;
  assetCount: number;
  areas: Record<string, number>;
  confirmation: string;
};

export type SkctBankActivationResult = SkctBankPreview & {
  activated: true;
  replayed: boolean;
};

function object(value: unknown, message: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as JsonRecord;
}

function text(value: unknown, message: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) throw new Error(message);
  return value;
}

function count(value: unknown, message: string) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 500) throw new Error(message);
  return Number(value);
}

export function parseSkctBankPreview(value: unknown): SkctBankPreview {
  const input = object(value, "SKCT 문제은행 검증 응답 형식이 올바르지 않습니다.");
  const releaseId = text(input.releaseId, "SKCT release ID 응답이 올바르지 않습니다.");
  const releaseSha256 = text(input.releaseSha256, "SKCT release SHA 응답이 올바르지 않습니다.");
  if (!/^[a-f0-9]{64}$/u.test(releaseSha256)) throw new Error("SKCT release SHA 응답이 올바르지 않습니다.");
  const areasInput = object(input.areas, "SKCT 영역별 문항 수 응답이 올바르지 않습니다.");
  const areas = Object.fromEntries(Object.entries(areasInput).map(([area, value]) => [
    text(area, "SKCT 영역 이름이 올바르지 않습니다."),
    count(value, "SKCT 영역별 문항 수 응답이 올바르지 않습니다."),
  ]));
  const confirmation = text(input.confirmation, "SKCT 활성화 확인값 응답이 올바르지 않습니다.");
  if (confirmation !== `ACTIVATE ${releaseId} ${releaseSha256}`) {
    throw new Error("SKCT 활성화 확인값이 release와 일치하지 않습니다.");
  }
  return {
    canActivate: input.canActivate === true,
    releaseId,
    releaseSha256,
    eligibleCount: count(input.eligibleCount, "SKCT 사용 가능 문항 수 응답이 올바르지 않습니다."),
    quarantineCount: count(input.quarantineCount, "SKCT 격리 문항 수 응답이 올바르지 않습니다."),
    assetCount: count(input.assetCount, "SKCT 도식 수 응답이 올바르지 않습니다."),
    areas,
    confirmation,
  };
}

export function parseSkctBankActivationResult(value: unknown): SkctBankActivationResult {
  const input = object(value, "SKCT 문제은행 활성화 응답 형식이 올바르지 않습니다.");
  const preview = parseSkctBankPreview(input);
  if (input.activated !== true || typeof input.replayed !== "boolean") {
    throw new Error("SKCT 문제은행 활성화 결과를 확인할 수 없습니다.");
  }
  return { ...preview, activated: true, replayed: input.replayed };
}

export function isExpectedSkctRelease(preview: SkctBankPreview) {
  return preview.canActivate
    && preview.releaseId === EXPECTED_SKCT_RELEASE.releaseId
    && preview.releaseSha256 === EXPECTED_SKCT_RELEASE.releaseSha256
    && preview.eligibleCount === EXPECTED_SKCT_RELEASE.eligibleCount
    && preview.quarantineCount === EXPECTED_SKCT_RELEASE.quarantineCount
    && preview.assetCount === EXPECTED_SKCT_RELEASE.assetCount
    && Object.entries(EXPECTED_SKCT_RELEASE.areas).every(([area, count]) => preview.areas[area] === count)
    && Object.keys(preview.areas).length === Object.keys(EXPECTED_SKCT_RELEASE.areas).length;
}
