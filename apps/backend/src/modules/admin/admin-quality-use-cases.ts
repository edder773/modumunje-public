import {
  type D1Row,
  adminRepository,
  allRows,
  execute,
  hasExplicitModelAnswerHeading,
  hasUnsafeLongLine,
  isDescriptiveAllowed,
  contentScopeAllowsSubject,
  jsonList,
  markdownFenceBalanced,
  modelAnswerForQuality,
  normalizeComparableContent,
  normalizedDuplicateKey,
  now,
  numberList,
  questionContentFingerprint,
  uniqueStrings,
} from "./admin-use-case-runtime";
import { splitQuestionPromptForDisplay } from "@shared/content/content-format.mjs";
import { contentDomainForScope, CONTENT_ADMIN_DOMAINS, type ContentAdminDomain } from "@shared/admin/content-domains";
import { gradePracticalAnswer } from "../study/ipe-practical-grading";
import { reviewedPracticalPrompt } from "../study/practical-question-presentation";
import { isPracticalPastQuestion } from "@shared/study/ipe-practical-past.mjs";
import { EXPECTED_SCHEMA_VERSION } from "@shared/database/schema-contract.mjs";

export const QUALITY_INVALIDATING_ACTIONS = new Set([
  "question-create",
  "question-update",
  "question-duplicate",
  "question-deactivate",
  "question-delete",
  "question-delete-inactive",
  "question-bulk",
  "theory-create",
  "theory-update",
  "theory-deactivate",
  "theory-delete",
  "theory-link",
  "sw-question-create",
  "sw-question-update",
  "sw-question-deactivate",
  "sw-theory-create",
  "sw-theory-update",
  "sw-theory-deactivate",
  "import-commit",
  "restore-run",
  "quality-fix",
]);

const QUALITY_CACHE_KEY = `content:${EXPECTED_SCHEMA_VERSION}:rules-v3`;
const QUALITY_CACHE_TTL_MS = 30 * 60_000;
const QUALITY_CACHE_CHUNK_CHARACTERS = 80_000;


export type QualityIssue = {
  id: string;
  severity: "error" | "warning" | "info";
  targetType: "question" | "theory" | "sw-question" | "sw-theory" | "collection";
  targetId: string | number | null;
  targetIds?: Array<string | number>;
  domain?: ContentAdminDomain;
  title: string;
  detail: string;
  fixable: boolean;
  fixAction?: string;
};

type QualityData = {
  generatedAt: string;
  ruleVersion: string;
  coverage: Array<{ domain: ContentAdminDomain; questions: number; theories: number }>;
  summary: {
    total: number;
    error: number;
    warning: number;
    info: number;
    autoFixable: number;
  };
  issues: QualityIssue[];
};

function appendGroup<K, T>(groups: Map<K, T[]>, key: K, value: T) {
  const existing = groups.get(key);
  if (existing) existing.push(value);
  else groups.set(key, [value]);
}

export async function computeQuality() {
  const [questionRows, theoryRows, swQuestionRows, swTheoryRows, evaluationErrors] = await Promise.all([
    allRows(`
      SELECT id, theory_id, category, display_order, exam_scope, kind, prompt,
             choices, correct_answers, explanation, tags, scoring_criteria,
             required_concepts, variant_group_id, active
      FROM questions WHERE active = 1 ORDER BY id
    `),
    allRows(`
      SELECT id, title, content, exam_scope, active
      FROM theories WHERE active = 1 ORDER BY id
    `),
    allRows(`
      SELECT id, theory_id, display_order, kind, prompt, choices,
             correct_answers, explanation, active
      FROM sw_questions WHERE active = 1 ORDER BY id
    `),
    allRows(`
      SELECT id, title, content, active
      FROM sw_theories WHERE active = 1 ORDER BY id
    `),
    allRows(`
      SELECT question_id, COUNT(*) AS count
      FROM system_errors
      WHERE question_id IS NOT NULL
        AND error_type LIKE '%evaluation%'
      GROUP BY question_id
    `),
  ]);
  const issues: QualityIssue[] = [];
  const promptGroups = new Map<string, number[]>();
  const stemGroups = new Map<string, number[]>();
  const explanationGroups = new Map<string, number[]>();
  const displayOrders = new Map<number, number[]>();
  const questionVariantGroups = new Map<number, string>();
  const questionDomains = new Map<number, ContentAdminDomain | undefined>();
  const swPromptGroups = new Map<string, string[]>();
  const swStemGroups = new Map<string, string[]>();
  const swExplanationGroups = new Map<string, string[]>();
  const swDisplayOrders = new Map<
    string,
    { theoryId: number; displayOrder: number; ids: string[] }
  >();
  const evaluationErrorCounts = new Map(
    evaluationErrors.map((row: D1Row) => [Number(row.question_id), Number(row.count)]),
  );

  for (const row of questionRows) {
    const id = Number(row.id);
    questionDomains.set(id, contentDomainForScope(String(row.exam_scope)));
    questionVariantGroups.set(id, String(row.variant_group_id ?? "").trim());
    const kind = String(row.kind);
    const prompt = String(row.prompt ?? "");
    const explanation = String(row.explanation ?? "");
    const choices = jsonList(row.choices);
    const correct = numberList(row.correct_answers);
    const active = Boolean(row.active);
    const add = (
      severity: QualityIssue["severity"],
      title: string,
      detail: string,
      fixable = false,
      fixAction?: string,
    ) => issues.push({
      id: `question-${id}-${issues.length}`,
      severity,
      targetType: "question",
      targetId: id,
      targetIds: [id],
      domain: contentDomainForScope(String(row.exam_scope)),
      title,
      detail,
      fixable,
      fixAction,
    });

    if (!contentDomainForScope(String(row.exam_scope)) || !contentScopeAllowsSubject(String(row.exam_scope), String(row.category))) add("error", "과정·과목 분류 오류", "등록된 과정의 과목 구성에 맞지 않습니다.");
    if (!["single", "multiple", "descriptive"].includes(kind)) add("error", "문제 유형 오류", "등록된 문제 유형이 아닙니다.");
    if (kind === "single" && correct.length !== 1) add("error", "단일 정답 개수 오류", "단일 정답 문제에는 정답 번호가 하나만 있어야 합니다.");
    if (new Set(correct).size !== correct.length) add("error", "중복 정답 번호", "같은 정답 번호가 반복 등록되어 있습니다.");
    if (active && !prompt.trim()) add("error", "문제 본문 누락", "문제 본문이 비어 있습니다.");
    if (active && !explanation.trim()) add("error", "해설 누락", "정답 판단 근거와 해설이 없습니다.");
    if (active && kind !== "descriptive" && ![2, 4].includes(choices.length)) {
      add("error", "객관식 선택지 오류", `선택지가 ${choices.length}개입니다. OX형 2개 또는 일반형 4개여야 합니다.`);
    }
    if (
      active
      &&
      kind !== "descriptive"
      && (!correct.length || correct.some((answer) => answer < 0 || answer >= choices.length))
    ) {
      add("error", "정답 번호 오류", "정답이 없거나 선택지 범위를 벗어났습니다.");
    }
    const practical = kind === "descriptive" && String(row.exam_scope) === "IPEP";
    if (practical) {
      const grading = await gradePracticalAnswer({ id, examScope: "IPEP", kind, prompt, explanation }, "");
      if (!grading) add("error", "실기 정답표 확인 필요", "등록된 정답표가 없거나 현재 문제·해설이 검증한 정답표의 내용과 일치하지 않습니다.");
    }
    if (kind === "descriptive" && active && !practical) {
      if (
        !isDescriptiveAllowed(String(row.exam_scope), String(row.category))
      ) {
        add(
          "error",
          "서술형 시험 범위 오류",
          "서술형은 등록된 과정의 지정 과목에서만 활성화할 수 있습니다.",
        );
      }
      const scoringCriteria = uniqueStrings(row.scoring_criteria);
      const requiredConcepts = uniqueStrings(row.required_concepts);
      const normalizedModelAnswer = normalizeComparableContent(modelAnswerForQuality(explanation));
      const hasExplicitHeading = hasExplicitModelAnswerHeading(explanation);
      const hasTechnicalShortAnswer = normalizedModelAnswer.length >= 12
        && /(?:\b(?:no_merge|leading|ordered|use_nl|use_hash|use_merge|index|full|push_subq|no_unnest)\b|(?:select|insert|update|delete)\s+)/i
          .test(normalizedModelAnswer);
      const hasSubstantiveModelAnswer = normalizedModelAnswer.length >= 48
        || hasTechnicalShortAnswer
        || (hasExplicitHeading && normalizedModelAnswer.length >= 8);
      const hasUsefulTags = uniqueStrings(row.tags)
        .some((tag) => normalizeComparableContent(tag).length >= 2);
      if (!scoringCriteria.length && !hasSubstantiveModelAnswer) {
        add(
          "error",
          "서술형 채점 기준 누락",
          "명시 채점 기준과 내부 모범답안이 모두 비어 있거나 너무 짧습니다.",
        );
      }
      if (
        !requiredConcepts.length
        && !scoringCriteria.length
        && !hasSubstantiveModelAnswer
        && !hasUsefulTags
      ) {
        add(
          "error",
          "서술형 필수 개념 누락",
          "필수 개념을 추출할 채점 기준·모범답안·태그가 없습니다.",
        );
      }
      if (!hasSubstantiveModelAnswer) {
        add("warning", "서술형 모범답안 확인 필요", "해설에서 모범답안 구역을 찾지 못했습니다.");
      }
      if (evaluationErrorCounts.get(id)) {
        add(
          "warning",
          "과거 자동 채점 오류 기록",
          `AI 채점 종료 전에 이 문제에서 자동 채점 오류가 ${evaluationErrorCounts.get(id)}건 기록되었습니다.`,
        );
      }
    }
    if (active && /문제\s*풀이\s*적용/.test(explanation)) {
      add(
        "warning",
        "문제 풀이 적용 상용구",
        "더 이상 사용하지 않는 공통 상용구가 남아 있습니다.",
        true,
        "remove-problem-application",
      );
    }
    if (!row.theory_id && active && !(practical && isPracticalPastQuestion(id))) {
      add("warning", "연결 이론 없음", "활성 문제에 직접 연결된 이론이 없습니다.");
    }
    if (active && splitQuestionPromptForDisplay(reviewedPracticalPrompt(Number(row.id), prompt) ?? prompt).stem.length > 140) {
      add("info", "긴 문제 지시문", "학습 화면에 표시되는 문제 지시문이 140자를 초과합니다.");
    }
    if (active && (!markdownFenceBalanced(prompt) || !markdownFenceBalanced(explanation))) {
      add("error", "마크다운 코드 펜스 오류", "코드 블록의 시작과 끝 개수가 맞지 않습니다.");
    }
    if (active && (hasUnsafeLongLine(prompt) || hasUnsafeLongLine(explanation))) {
      add("warning", "모바일 위험 긴 문자열", "줄바꿈 없는 긴 문자열이 있어 모바일 화면을 점검해야 합니다.");
    }
    const promptKey = kind === "descriptive"
      ? normalizedDuplicateKey(`${prompt}\n${kind}`)
      : questionContentFingerprint({
        kind,
        prompt,
        choices,
        correctAnswers: correct,
      });
    if (active && promptKey) {
      appendGroup(promptGroups, promptKey, id);
    }
    const stemKey = normalizedDuplicateKey(prompt);
    if (active && kind !== "descriptive" && stemKey) {
      appendGroup(stemGroups, stemKey, id);
    }
    const explanationKey = normalizedDuplicateKey(explanation);
    if (active && explanationKey) {
      appendGroup(explanationGroups, explanationKey, id);
    }
    if (active) {
      const order = Number(row.display_order);
      appendGroup(displayOrders, order, id);
    }
  }

  const promptGroupMembership = new Set(
    [...promptGroups.values()].map((ids) => ids.join(",")),
  );

  for (const [key, ids] of promptGroups) {
    if (key && ids.length > 1) {
      issues.push({
        id: `duplicate-prompt-${ids.join("-")}`,
        severity: "warning",
        targetType: "collection",
        targetId: null,
        targetIds: ids,
        domain: ids.every((id) => questionDomains.get(id) === questionDomains.get(ids[0]))
          ? questionDomains.get(ids[0])
          : undefined,
        title: "중복 문제 가능성",
        detail: `문제 ${ids.join(", ")}의 본문이 동일하거나 매우 유사합니다.`,
        fixable: false,
      });
    }
  }
  for (const [key, ids] of stemGroups) {
    const reviewedVariantGroup = questionVariantGroups.get(ids[0]) ?? "";
    const isReviewedVariantGroup = Boolean(reviewedVariantGroup) && ids.every(
      (id) => questionVariantGroups.get(id) === reviewedVariantGroup,
    );
    if (key && ids.length > 1 && !promptGroupMembership.has(ids.join(",")) && !isReviewedVariantGroup) {
      issues.push({
        id: `variant-stem-${ids.join("-")}`,
        severity: "warning",
        targetType: "collection",
        targetId: null,
        targetIds: ids,
        domain: ids.every((id) => questionDomains.get(id) === questionDomains.get(ids[0]))
          ? questionDomains.get(ids[0])
          : undefined,
        title: "선택지만 다른 변형 문제 가능성",
        detail: `문제 ${ids.join(", ")}의 본문은 같지만 선택지 또는 정답 구성이 다릅니다. 변형 그룹 출제 정책을 확인하세요.`,
        fixable: false,
      });
    }
  }
  for (const [key, ids] of explanationGroups) {
    if (key.length > 80 && ids.length > 2) {
      issues.push({
        id: `duplicate-explanation-${ids.join("-")}`,
        severity: "warning",
        targetType: "collection",
        targetId: null,
        targetIds: ids,
        domain: ids.every((id) => questionDomains.get(id) === questionDomains.get(ids[0]))
          ? questionDomains.get(ids[0])
          : undefined,
        title: "동일 해설 반복",
        detail: `문제 ${ids.slice(0, 12).join(", ")}${ids.length > 12 ? " 외" : ""}에서 같은 해설이 반복됩니다.`,
        fixable: false,
      });
    }
  }
  for (const [order, ids] of displayOrders) {
    if (ids.length > 1) {
      issues.push({
        id: `display-order-${order}`,
        severity: "error",
        targetType: "collection",
        targetId: null,
        targetIds: ids,
        domain: ids.every((id) => questionDomains.get(id) === questionDomains.get(ids[0]))
          ? questionDomains.get(ids[0])
          : undefined,
        title: "표시 번호 충돌",
        detail: `표시 번호 ${order}를 문제 ${ids.join(", ")}가 함께 사용합니다.`,
        fixable: true,
        fixAction: "reindex-display-order",
      });
    }
  }

  for (const row of theoryRows) {
    const id = Number(row.id);
    const content = String(row.content ?? "");
    if (!Boolean(row.active)) continue;
    if (!String(row.title ?? "").trim() || !content.trim()) {
      issues.push({
        id: `theory-${id}-missing`,
        severity: "error",
        targetType: "theory",
        targetId: id,
        targetIds: [id],
        domain: contentDomainForScope(String(row.exam_scope)),
        title: "이론 제목 또는 본문 누락",
        detail: "이론을 학습 화면에 제공하기 위한 필수 내용이 없습니다.",
        fixable: false,
      });
    }
    if (!markdownFenceBalanced(content)) {
      issues.push({
        id: `theory-${id}-markdown`,
        severity: "error",
        targetType: "theory",
        targetId: id,
        targetIds: [id],
        domain: contentDomainForScope(String(row.exam_scope)),
        title: "이론 마크다운 오류",
        detail: "코드 블록의 시작과 끝 개수가 맞지 않습니다.",
        fixable: false,
      });
    }
    if (hasUnsafeLongLine(content)) {
      issues.push({
        id: `theory-${id}-mobile`,
        severity: "warning",
        targetType: "theory",
        targetId: id,
        targetIds: [id],
        domain: contentDomainForScope(String(row.exam_scope)),
        title: "이론의 모바일 위험 콘텐츠",
        detail: "줄바꿈 없는 긴 문자열이 있습니다.",
        fixable: false,
      });
    }
  }

  for (const row of swQuestionRows) {
    const id = String(row.id ?? "").trim();
    if (!Boolean(row.active)) continue;
    const kind = String(row.kind ?? "single");
    const prompt = String(row.prompt ?? "");
    const explanation = String(row.explanation ?? "");
    const choices = jsonList(row.choices);
    const correct = numberList(row.correct_answers);
    const addSwQuestionIssue = (
      severity: QualityIssue["severity"], title: string, detail: string,
    ) => issues.push({
      id: `sw-question-${id}-${issues.length}`,
      severity,
      targetType: "sw-question",
      targetId: id,
      targetIds: [id],
      domain: "sw",
      title,
      detail,
      fixable: false,
    });
    if (!prompt.trim()) addSwQuestionIssue("error", "SW 문제 본문 누락", "문제 본문이 비어 있습니다.");
    if (!explanation.trim()) addSwQuestionIssue("error", "SW 문제 해설 누락", "정답 판단 근거와 해설이 없습니다.");
    if (choices.length !== 4) addSwQuestionIssue("error", "SW 문제 선택지 오류", `선택지가 ${choices.length}개입니다. 4개여야 합니다.`);
    if (!correct.length || correct.some((answer) => answer < 0 || answer >= choices.length)) {
      addSwQuestionIssue("error", "SW 문제 정답 번호 오류", "정답이 없거나 선택지 범위를 벗어났습니다.");
    }
    if (!row.theory_id) addSwQuestionIssue("warning", "SW 문제 연결 이론 없음", "활성 문제에 직접 연결된 이론이 없습니다.");
    if (splitQuestionPromptForDisplay(prompt).stem.length > 140) {
      addSwQuestionIssue("info", "긴 SW 문제 지시문", "학습 화면에 표시되는 문제 지시문이 140자를 초과합니다.");
    }
    if (!markdownFenceBalanced(prompt) || !markdownFenceBalanced(explanation)) {
      addSwQuestionIssue("error", "SW 문제 마크다운 오류", "코드 블록의 시작과 끝 개수가 맞지 않습니다.");
    }
    if (hasUnsafeLongLine(prompt) || hasUnsafeLongLine(explanation)) {
      addSwQuestionIssue("warning", "SW 문제의 모바일 위험 콘텐츠", "줄바꿈 없는 긴 문자열이 있습니다.");
    }
    const promptKey = questionContentFingerprint({
      kind,
      prompt,
      choices,
      correctAnswers: correct,
    });
    if (promptKey) {
      appendGroup(swPromptGroups, promptKey, id);
    }
    const stemKey = normalizedDuplicateKey(prompt);
    if (stemKey) {
      appendGroup(swStemGroups, stemKey, id);
    }
    const explanationKey = normalizedDuplicateKey(explanation);
    if (explanationKey) {
      appendGroup(swExplanationGroups, explanationKey, id);
    }
    const theoryId = Number(row.theory_id);
    const displayOrder = Number(row.display_order);
    if (Number.isInteger(theoryId) && Number.isInteger(displayOrder)) {
      const orderKey = `${theoryId}:${displayOrder}`;
      const group = swDisplayOrders.get(orderKey) ?? { theoryId, displayOrder, ids: [] };
      group.ids.push(id);
      swDisplayOrders.set(orderKey, group);
    }
  }

  const swPromptGroupMembership = new Set(
    [...swPromptGroups.values()].map((ids) => ids.join(",")),
  );

  for (const ids of swPromptGroups.values()) {
    if (ids.length < 2) continue;
    issues.push({
      id: `sw-duplicate-prompt-${ids.join("-")}`,
      severity: "warning",
      targetType: "sw-question",
      targetId: ids[0],
      targetIds: ids,
      title: "SW 중복 문제 가능성",
      detail: `SW 문제 ${ids.join(", ")}의 본문·선택지·정답이 같습니다.`,
      fixable: false,
    });
  }
  for (const ids of swStemGroups.values()) {
    const sameFullGroup = swPromptGroupMembership.has(ids.join(","));
    if (ids.length < 2 || sameFullGroup) continue;
    issues.push({
      id: `sw-variant-stem-${ids.join("-")}`,
      severity: "warning",
      targetType: "sw-question",
      targetId: ids[0],
      targetIds: ids,
      title: "선택지만 다른 SW 변형 문제 가능성",
      detail: `SW 문제 ${ids.join(", ")}의 본문은 같지만 선택지 또는 정답 구성이 다릅니다.`,
      fixable: false,
    });
  }
  for (const [key, ids] of swExplanationGroups) {
    if (key.length <= 80 || ids.length <= 2) continue;
    issues.push({
      id: `sw-duplicate-explanation-${ids.join("-")}`,
      severity: "warning",
      targetType: "sw-question",
      targetId: ids[0],
      targetIds: ids,
      title: "동일한 SW 해설 반복",
      detail: `SW 문제 ${ids.slice(0, 12).join(", ")}${ids.length > 12 ? " 외" : ""}에서 같은 해설이 반복됩니다.`,
      fixable: false,
    });
  }
  for (const { theoryId, displayOrder, ids } of swDisplayOrders.values()) {
    if (ids.length < 2) continue;
    issues.push({
      id: `sw-display-order-${theoryId}-${displayOrder}`,
      severity: "error",
      targetType: "sw-question",
      targetId: ids[0],
      targetIds: ids,
      title: "SW 이론 내 표시 번호 충돌",
      detail: `이론 ${theoryId}에서 표시 번호 ${displayOrder}를 문제 ${ids.join(", ")}가 함께 사용합니다.`,
      fixable: false,
    });
  }

  for (const row of swTheoryRows) {
    const id = Number(row.id);
    if (!Boolean(row.active)) continue;
    const content = String(row.content ?? "");
    const addSwTheoryIssue = (
      severity: QualityIssue["severity"], title: string, detail: string,
    ) => issues.push({
      id: `sw-theory-${id}-${issues.length}`,
      severity,
      targetType: "sw-theory",
      targetId: id,
      targetIds: [id],
      domain: "sw",
      title,
      detail,
      fixable: false,
    });
    if (!String(row.title ?? "").trim() || !content.trim()) {
      addSwTheoryIssue("error", "SW 이론 제목 또는 본문 누락", "학습 화면에 필요한 제목이나 본문이 없습니다.");
    }
    if (!markdownFenceBalanced(content)) {
      addSwTheoryIssue("error", "SW 이론 마크다운 오류", "코드 블록의 시작과 끝 개수가 맞지 않습니다.");
    }
    if (hasUnsafeLongLine(content)) {
      addSwTheoryIssue("warning", "SW 이론의 모바일 위험 콘텐츠", "줄바꿈 없는 긴 문자열이 있습니다.");
    }
  }

  const summary = issues.reduce((result, issue) => {
    result[issue.severity] += 1;
    if (issue.fixable) result.autoFixable += 1;
    return result;
  }, { total: issues.length, error: 0, warning: 0, info: 0, autoFixable: 0 });
  return {
    generatedAt: now(),
    ruleVersion: "2026-09-09-v3",
    coverage: CONTENT_ADMIN_DOMAINS.map(domain => ({
      domain: domain.id,
      questions: domain.id === "sw" ? swQuestionRows.length : questionRows.filter(row => contentDomainForScope(String(row.exam_scope)) === domain.id).length,
      theories: domain.id === "sw" ? swTheoryRows.length : theoryRows.filter(row => contentDomainForScope(String(row.exam_scope)) === domain.id).length,
    })),
    summary,
    issues,
  } satisfies QualityData;
}

let qualitySnapshot: { expiresAt: number; data: QualityData } | null = null;
let qualityGeneration = 0;
let pendingQualitySnapshot: { generation: number; promise: Promise<QualityData> } | null = null;

function qualityData(value: unknown): QualityData | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<QualityData>;
  if (
    typeof candidate.generatedAt !== "string"
    || candidate.ruleVersion !== "2026-09-09-v3"
    || !Array.isArray(candidate.coverage)
    || !candidate.summary
    || !Array.isArray(candidate.issues)
  ) return null;
  return candidate as QualityData;
}

async function readDurableQualitySnapshot(timestamp: number) {
  const rows = await allRows<{
    chunk_index: number;
    payload: string;
    generated_at: string;
    expires_at: number;
  }>(`
    SELECT chunk_index, payload, generated_at, expires_at
    FROM admin_quality_cache
    WHERE cache_key = ? AND expires_at > ?
    ORDER BY chunk_index
  `, [QUALITY_CACHE_KEY, timestamp]);
  if (!rows.length) return null;
  try {
    if (rows.some((row, index) => Number(row.chunk_index) !== index)) {
      throw new Error("quality cache chunks are not contiguous");
    }
    const data = qualityData(JSON.parse(rows.map((row) => row.payload).join("")));
    if (!data) return null;
    return {
      data,
      expiresAt: Number(rows[0].expires_at),
    };
  } catch {
    await execute("DELETE FROM admin_quality_cache WHERE cache_key = ?", [QUALITY_CACHE_KEY]);
    return null;
  }
}

async function writeDurableQualitySnapshot(data: QualityData, expiresAt: number) {
  const serialized = JSON.stringify(data);
  const chunks: string[] = [];
  for (let offset = 0; offset < serialized.length; offset += QUALITY_CACHE_CHUNK_CHARACTERS) {
    chunks.push(serialized.slice(offset, offset + QUALITY_CACHE_CHUNK_CHARACTERS));
  }
  const timestamp = Date.now();
  await adminRepository.batch([
    {
      sql: "DELETE FROM admin_quality_cache WHERE cache_key = ? OR expires_at <= ?",
      values: [QUALITY_CACHE_KEY, timestamp],
    },
    ...chunks.map((payload, chunkIndex) => ({
      sql: `
        INSERT INTO admin_quality_cache (
          cache_key, chunk_index, payload, generated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
      values: [QUALITY_CACHE_KEY, chunkIndex, payload, data.generatedAt, expiresAt],
    })),
  ]);
}

async function computeAndCacheQuality(generation: number) {
  const data = await computeQuality();
  const expiresAt = Date.now() + QUALITY_CACHE_TTL_MS;
  if (generation !== qualityGeneration) return data;
  qualitySnapshot = { expiresAt, data };
  try {
    await writeDurableQualitySnapshot(data, expiresAt);
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "admin_quality_cache_write_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
  }
  return data;
}

export async function readQuality(force = false) {
  const timestamp = Date.now();
  if (!force && qualitySnapshot && qualitySnapshot.expiresAt > timestamp) {
    return { ...qualitySnapshot.data, cached: true };
  }
  if (!force) {
    const durable = await readDurableQualitySnapshot(timestamp);
    if (durable) {
      qualitySnapshot = durable;
      return { ...durable.data, cached: true };
    }
  }
  const generation = qualityGeneration;
  if (!pendingQualitySnapshot || pendingQualitySnapshot.generation !== generation) {
    pendingQualitySnapshot = {
      generation,
      promise: computeAndCacheQuality(generation),
    };
  }
  const pending = pendingQualitySnapshot;
  let data: QualityData;
  try {
    data = await pending.promise;
  } finally {
    if (pendingQualitySnapshot === pending) pendingQualitySnapshot = null;
  }
  return { ...data, cached: false };
}

export async function invalidateQualitySnapshot() {
  qualityGeneration += 1;
  qualitySnapshot = null;
  pendingQualitySnapshot = null;
  await execute("DELETE FROM admin_quality_cache WHERE cache_key = ?", [QUALITY_CACHE_KEY]);
}
