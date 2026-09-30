import { persistSkctValidatedBank } from "./admin-skct-bank-persistence";
import { APPROVED_SKCT_NEW300_GROUP_RELEASE } from "@shared/group-exams/approved-release";
import type { AdminIdentity, JsonRecord } from "./admin-use-case-runtime";

const BANK_SCHEMA = "baeumzip.skct-group-bank.v1";
const NEW_BANK_SCHEMA = "baeumzip.skct-group-bank.v2";
// A reviewed, byte-for-byte candidate from the four newly authored archives.
// Changing content requires a new release id and an independently reviewed digest.
const NEW_BANK_RELEASE_SHA256 = APPROVED_SKCT_NEW300_GROUP_RELEASE.sha256;
const NEW_BANK_REVIEW_SHA256 = "e4ea7a1852cc00c5331aa65d92528afc991bbfb72e189a96f4548f845dd4864a";
const NEW_BANK_ARCHIVES = new Map<string, readonly [string, string, number]>([
  ["B01", ["skct_new_b01_20260927.zip", "0f0e4e9ce08c06415d279ed891bf072a33b71cc3d119d3fc224ff16b9d86c24b", 4]],
  ["B02", ["skct_new_b02_20260927.zip", "bbbee0d1cad25b31d897c614c5c69edaeea41b141a8a3561067d7d690a3ec1c5", 4]],
  ["B03", ["skct_new_b03_20260927.zip", "325ce4327f96d7c5383512cf0ed446be0a40d2bd0abbd90e3a6eed542ff23a16", 4]],
  ["U01_REPLACEMENT", ["skct_language60_final_20260927.zip", "2a777970346c40e2c837de9299b4650df2224f87f795305d5b343f22adf67e08", 1]],
]);
const MINIMUM_QUESTION_COUNT = 15;
const ALLOWED_AREAS = new Set(["언어이해", "자료해석", "창의수리", "언어추리", "수열추리"]);
const SHA256 = /^[a-f0-9]{64}$/u;

type SourceRef = {
  sourceId: string;
  sourceSha256: string;
  pageBlock: string;
  jsonPointer: string;
};

export type BankQuestion = {
  questionUid: string;
  contentSet: string;
  areaCode: string;
  questionNo: number;
  kind: "single";
  promptMd: string;
  choices: string[];
  correctAnswers: number[];
  explanationMd: string;
  dependencyGroupId: string | null;
  assets: BankAsset[];
  provenance: {
    question: { unifiedMdLines?: number[]; sourceRefs: SourceRef[] };
    answerExplanation: { unifiedMdLines?: number[]; sourceRefs: SourceRef[] };
  };
};

type BankAsset = {
  path: string;
  sha256: string;
  bytes?: number;
  alt?: string;
};

export type SkctBank = {
  schema: typeof BANK_SCHEMA | typeof NEW_BANK_SCHEMA;
  dataset: string;
  releaseId: string;
  status: string;
  source: JsonRecord;
  choiceIndexBase: number;
  questions: BankQuestion[];
  releaseSha256: string;
};

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 형식이 유효하지 않습니다.`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string, maximum = 20_000) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} 값이 유효하지 않습니다.`);
  }
  return value;
}

function sourceRefs(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} 출처가 없습니다.`);
  return value.map((candidate, index) => {
    const row = object(candidate, `${label} 출처 ${index + 1}`);
    const sourceSha256 = text(row.sourceSha256, `${label} source SHA`, 64);
    if (!SHA256.test(sourceSha256)) throw new Error(`${label} source SHA 형식이 유효하지 않습니다.`);
    return {
      sourceId: text(row.sourceId, `${label} source ID`, 200),
      sourceSha256,
      pageBlock: text(row.pageBlock, `${label} page block`, 300),
      jsonPointer: text(row.jsonPointer, `${label} JSON pointer`, 300),
    };
  });
}

function provenance(value: unknown, label: string, authored: boolean) {
  const row = object(value, `${label} provenance`);
  if (authored) {
    if (row.unifiedMdLines !== undefined) throw new Error(`${label} 신규 출처에 구형 MD 줄번호가 포함되었습니다.`);
    return { sourceRefs: sourceRefs(row.sourceRefs, label) };
  }
  if (!Array.isArray(row.unifiedMdLines) || row.unifiedMdLines.length !== 2
    || row.unifiedMdLines.some((line) => !Number.isInteger(line) || Number(line) < 1)) {
    throw new Error(`${label} MD line range가 유효하지 않습니다.`);
  }
  return {
    unifiedMdLines: row.unifiedMdLines.map(Number),
    sourceRefs: sourceRefs(row.sourceRefs, label),
  };
}

function assets(value: unknown, label: string): BankAsset[] {
  if (!Array.isArray(value)) throw new Error(`${label} asset 목록이 유효하지 않습니다.`);
  return value.map((candidate, index) => {
    const row = object(candidate, `${label} asset ${index + 1}`);
    const path = text(row.path, `${label} asset 경로`, 240);
    const assetSha256 = text(row.sha256, `${label} asset SHA`, 64);
    if (!/^assets\/[A-Za-z0-9._/-]+[.]svg$/u.test(path) || path.includes("..") || path.includes("//")) {
      throw new Error(`${label} asset 경로가 안전한 로컬 SVG가 아닙니다.`);
    }
    if (!SHA256.test(assetSha256)) throw new Error(`${label} asset SHA 형식이 유효하지 않습니다.`);
    if (row.bytes !== undefined && (!Number.isInteger(row.bytes) || Number(row.bytes) < 1 || Number(row.bytes) > 1_000_000)) {
      throw new Error(`${label} asset byte 크기가 유효하지 않습니다.`);
    }
    const alt = row.alt === undefined ? undefined : text(row.alt, `${label} 대체 텍스트`, 1000);
    return { path, sha256: assetSha256, ...(row.bytes === undefined ? {} : { bytes: Number(row.bytes) }),
      ...(alt === undefined ? {} : { alt }) };
  });
}

function validateAuthoredSource(source: JsonRecord) {
  if (source.kind !== "authored-local-archives-v1" || !Array.isArray(source.archives)
    || source.archives.length !== NEW_BANK_ARCHIVES.size) throw new Error("신규 SKCT 출처 묶음이 유효하지 않습니다.");
  const review = object(source.reviewEvidence, "신규 SKCT 검수 증거");
  if (review.sha256 !== NEW_BANK_REVIEW_SHA256 || typeof review.limits !== "string" || !review.limits) {
    throw new Error("신규 SKCT 검수 증거가 일치하지 않습니다.");
  }
  const seen = new Set<string>();
  const selectedSha = new Set<string>();
  for (const candidate of source.archives) {
    const archive = object(candidate, "신규 SKCT archive");
    const batch = text(archive.batch, "신규 SKCT batch", 30);
    const expected = NEW_BANK_ARCHIVES.get(batch);
    if (!expected || seen.has(batch) || archive.fileName !== expected[0] || archive.sha256 !== expected[1]
      || !Array.isArray(archive.selectedFiles) || archive.selectedFiles.length !== expected[2]) {
      throw new Error("신규 SKCT archive manifest가 승인된 원천과 다릅니다.");
    }
    seen.add(batch);
    for (const entry of archive.selectedFiles) {
      const file = object(entry, "신규 SKCT source file");
      const fileSha = text(file.sha256, "신규 SKCT source SHA", 64);
      if (!SHA256.test(fileSha)
        || !Number.isInteger(file.questions) || Number(file.questions) !== (batch === "U01_REPLACEMENT" ? 60 : 20)
        || (batch === "U01_REPLACEMENT" ? file.path !== "new_language_60.json"
          : !/^U0[2-5]\/unit\.json$/u.test(String(file.path)))) {
        throw new Error("신규 SKCT source file manifest가 유효하지 않습니다.");
      }
      selectedSha.add(fileSha);
    }
  }
  if (selectedSha.size !== 13) throw new Error("신규 SKCT source file이 중복되었습니다.");
  return selectedSha;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateBank(value: unknown): Promise<SkctBank> {
  const input = object(value, "SKCT 문제은행");
  if (input.schema !== BANK_SCHEMA && input.schema !== NEW_BANK_SCHEMA) throw new Error("SKCT 문제은행 schema가 유효하지 않습니다.");
  const authored = input.schema === NEW_BANK_SCHEMA;
  if (input.choiceIndexBase !== 0) throw new Error("SKCT 선택지 index 계약은 0부터 시작해야 합니다.");
  const source = object(input.source, "SKCT 원본 정보");
  const sourceShas = authored ? validateAuthoredSource(source) : null;
  if (!authored) {
    for (const field of ["jsonSha256", "mdSha256", "recoveryManifestSha256"] as const) {
      if (!SHA256.test(text(source[field], `SKCT ${field}`, 64))) {
        throw new Error(`SKCT ${field} 형식이 유효하지 않습니다.`);
      }
    }
    for (const field of ["completedFolderId", "jsonFileId", "mdFileId"] as const) {
      text(source[field], `SKCT ${field}`, 200);
    }
  }
  if (!Array.isArray(input.questions) || input.questions.length < MINIMUM_QUESTION_COUNT
    || input.questions.length > 500) {
    throw new Error(`SKCT 문제은행은 검증된 문항 ${MINIMUM_QUESTION_COUNT}~500개여야 합니다.`);
  }
  if (authored && (input.questions.length !== APPROVED_SKCT_NEW300_GROUP_RELEASE.eligibleCount
    || input.releaseId !== APPROVED_SKCT_NEW300_GROUP_RELEASE.id
    || input.dataset !== "SKCT newly authored practice 300")) {
    throw new Error("승인된 신규 SKCT 300문항 release가 아닙니다.");
  }
  const seen = new Set<string>();
  const questions = input.questions.map((candidate, index) => {
    const row = object(candidate, `SKCT 문항 ${index + 1}`);
    const questionUid = text(row.questionUid, "SKCT 문항 ID", 240);
    if (seen.has(questionUid)) throw new Error(`SKCT 문항 ID가 중복되었습니다: ${questionUid}`);
    seen.add(questionUid);
    const areaCode = text(row.areaCode, "SKCT 영역", 40);
    if (!ALLOWED_AREAS.has(areaCode)) throw new Error(`SKCT 영역이 유효하지 않습니다: ${areaCode}`);
    if (!Number.isInteger(row.questionNo) || Number(row.questionNo) < 1) {
      throw new Error(`SKCT 문항 번호가 유효하지 않습니다: ${questionUid}`);
    }
    if (row.kind !== "single") throw new Error(`SKCT 문항 형식은 single이어야 합니다: ${questionUid}`);
    if (!Array.isArray(row.choices) || row.choices.length !== 5
      || row.choices.some((choice) => typeof choice !== "string" || choice.length === 0)) {
      throw new Error(`SKCT 문항은 정확히 5개 선택지가 필요합니다: ${questionUid}`);
    }
    if (!Array.isArray(row.correctAnswers) || row.correctAnswers.length !== 1
      || !Number.isInteger(row.correctAnswers[0])
      || Number(row.correctAnswers[0]) < 0 || Number(row.correctAnswers[0]) > 4) {
      throw new Error(`SKCT 정답 index가 유효하지 않습니다: ${questionUid}`);
    }
    const provenanceRow = object(row.provenance, `SKCT 문항 ${questionUid}`);
    const questionProvenance = provenance(provenanceRow.question, `${questionUid} 문제`, authored);
    const answerProvenance = provenance(provenanceRow.answerExplanation, `${questionUid} 정답·해설`, authored);
    if (authored && (questionProvenance.sourceRefs.length !== 1 || answerProvenance.sourceRefs.length !== 1
      || !questionUid.startsWith("skct-new300/")
      || questionProvenance.sourceRefs[0].sourceId !== questionUid
      || answerProvenance.sourceRefs[0].sourceId !== questionUid
      || !sourceShas?.has(questionProvenance.sourceRefs[0].sourceSha256)
      || questionProvenance.sourceRefs[0].sourceSha256 !== answerProvenance.sourceRefs[0].sourceSha256)) {
      throw new Error(`신규 SKCT 문항 출처가 유효하지 않습니다: ${questionUid}`);
    }
    return {
      questionUid,
      contentSet: text(row.contentSet, "SKCT content set", 120),
      areaCode,
      questionNo: Number(row.questionNo),
      kind: "single" as const,
      promptMd: text(row.promptMd, "SKCT 문제 본문"),
      choices: row.choices as string[],
      correctAnswers: row.correctAnswers.map(Number),
      explanationMd: text(row.explanationMd, "SKCT 해설"),
      dependencyGroupId: row.dependencyGroupId === null
        ? null
        : text(row.dependencyGroupId, "SKCT 공통 자료 묶음", 240),
      assets: assets(row.assets, `SKCT 문항 ${questionUid}`),
      provenance: {
        question: questionProvenance,
        answerExplanation: answerProvenance,
      },
    };
  });
  if (authored && Object.entries(APPROVED_SKCT_NEW300_GROUP_RELEASE.areas).some(([area, count]) =>
    questions.filter((question) => question.areaCode === area).length !== count)) {
    throw new Error("신규 SKCT 영역별 문항 수가 60개가 아닙니다.");
  }
  if (authored && questions.reduce((count, question) => count + question.assets.length, 0)
    !== APPROVED_SKCT_NEW300_GROUP_RELEASE.assetCount) {
    throw new Error("신규 SKCT 도식 수가 승인된 release와 다릅니다.");
  }
  const releaseSha256 = text(input.releaseSha256, "SKCT release SHA", 64);
  if (!SHA256.test(releaseSha256)) throw new Error("SKCT release SHA 형식이 유효하지 않습니다.");
  if (authored && releaseSha256 !== NEW_BANK_RELEASE_SHA256) throw new Error("승인된 신규 SKCT 내용 hash가 아닙니다.");
  const core = { ...input };
  delete core.releaseSha256;
  if (await sha256(JSON.stringify(core)) !== releaseSha256) {
    throw new Error("SKCT 문제은행 release SHA가 본문과 일치하지 않습니다.");
  }
  if (input.status !== "validated") throw new Error("SKCT release는 validated 상태여야 합니다.");
  return {
    schema: input.schema as SkctBank["schema"],
    dataset: text(input.dataset, "SKCT dataset", 200),
    releaseId: text(input.releaseId, "SKCT release ID", 200),
    status: text(input.status, "SKCT release 상태", 40),
    source,
    choiceIndexBase: 0,
    questions,
    releaseSha256,
  };
}

function areaCounts(bank: SkctBank) {
  return Object.fromEntries([...ALLOWED_AREAS].map((area) => [
    area,
    bank.questions.filter((question) => question.areaCode === area).length,
  ]).filter(([, count]) => Number(count) > 0));
}

function activationSummary(bank: SkctBank) {
  const normalizedCount = bank.schema === NEW_BANK_SCHEMA ? bank.questions.length : 500;
  return {
    canActivate: true,
    releaseId: bank.releaseId,
    releaseSha256: bank.releaseSha256,
    eligibleCount: bank.questions.length,
    quarantineCount: normalizedCount - bank.questions.length,
    assetCount: bank.questions.reduce((count, question) => count + question.assets.length, 0),
    areas: areaCounts(bank),
    confirmation: `ACTIVATE ${bank.releaseId} ${bank.releaseSha256}`,
  };
}

export async function previewSkctBankActivation(value: unknown) {
  const bank = await validateBank(value);
  if (bank.schema !== NEW_BANK_SCHEMA) throw new Error("신규 작성 SKCT 300문항만 활성화할 수 있습니다.");
  return activationSummary(bank);
}

/** Read-only structural validation shared with persistence contract tests. */
export async function validateSkctBankForPersistence(value: unknown): Promise<SkctBank> {
  return validateBank(value);
}

export async function activateSkctBank(identity: AdminIdentity, value: unknown, confirmation: unknown) {
  const bank = await validateBank(value);
  if (bank.schema !== NEW_BANK_SCHEMA) throw new Error("신규 작성 SKCT 300문항만 활성화할 수 있습니다.");
  return persistSkctValidatedBank(identity, bank, confirmation);
}
