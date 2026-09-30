"use client";

import { choiceLabel } from "@shared/study/choice-label";

import {
  lazy,
  Suspense,
  useMemo,
} from "react";
import { learnerFacingMarkdown, markdownHeadingEntries } from "@shared/content/markdown-heading.mjs";
import {
  SUBJECTS,
  type DescriptiveEvaluation,
  type ExamResult,
  type ExamScope,
  type ExamConfig,
  type ExamType,
  type QuestionKind,
} from "@shared/study/study-domain";
import {
  normalizeExplanationMarkdown,
  normalizeMarkdownProse,
  splitQuestionPromptForDisplay,
  stripProblemApplicationSection,
  stripTheoryDifficultyMetadata,
} from "@shared/content/content-format.mjs";
import { splitTheoryReview } from "@shared/content/theory-review.mjs";
import { canonicalTopicLabel } from "@shared/content/topic-taxonomy.mjs";
import RetryBoundary from "@frontend/features/errors/retry-boundary";
export { calcStreak, compareTheories, gradedPracticeAttempts, scopeQuestions } from "../model/study-data-utils";

export type View = "dashboard" | "practice" | "mock" | "theory" | "wrong" | "incorrect" | "stats";
export type Difficulty = "하" | "중" | "상";
export type Question = {
  id: number;
  displayOrder: number;
  category: string;
  topic: string;
  examScope: ExamScope;
  difficulty: Difficulty;
  difficultyRationale: string;
  kind: QuestionKind;
  prompt: string;
  choices: string[];
  correctAnswers: number[];
  explanation: string;
  tags: string[];
  scoringCriteria: string[];
  requiredConcepts: string[];
  acceptableAlternatives: string[];
  deductionConditions: string[];
  errorConditions: string[];
  feedbackAuthorization?: string;
  historicalExam?: { id: string; year: number; round: number; title: string; number: number };
  shortAnswerInput?: import("@shared/study/practical-answer-fields").PracticalAnswerInput;
  theoryId: number | null;
  practiceScope: "general" | "theory_only";
  variantGroupId: string | null;
  bookmarked: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TheoryArticle = {
  id: number;
  title: string;
  category: string;
  topic: string;
  sortOrder: number;
  examScope: ExamScope;
  difficulty: string;
  summary: string;
  content: string;
  reviewAnswers: string;
  keywords: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Attempt = {
  id: number;
  questionId: number;
  selectedAnswers: number[];
  correct: boolean;
  mode: string;
  userKey: string;
  examType: ExamType;
  result: "correct" | "partial" | "incorrect";
  score: number;
  answerText: string;
  evaluationId: number | null;
  reviewStatus: string;
  createdAt: string;
};

type StoredEvaluation = DescriptiveEvaluation & {
  id: number;
  questionId: number;
  createdAt: string;
};

export type ExamSession = {
  examForm?: { id: string; year: number; round: number; title: string };
  id: string;
  examType: ExamType;
  status: "active" | "submitted";
  questionIds: number[];
  answers: Record<string, number[]>;
  descriptiveAnswers: Record<string, string>;
  descriptiveScores: Record<string, number>;
  descriptiveSnapshots: Record<string, string>;
  flagged: number[];
  currentIndex: number;
  startedAt: string;
  endsAt: string;
  submittedAt: string | null;
  result: ExamResult | Record<string, never>;
  policyVersion: string;
  policySnapshot: ExamConfig;
  revision: number;
  updatedAt: string;
};

type CourseOverviewStats = {
  contentQuestionCount: number;
  contentExplainedQuestionCount: number;
  contentTheoryCount: number;
  objectiveAttemptCount: number;
  completedTheoryCount: number;
  bookmarkCount: number;
  streak: number;
  hasActiveMock: boolean;
  recentActivity: string;
  lastActivityAt: string;
  lastActivityKind: "" | "practice" | "theory" | "mock";
  lastTheoryId: number | null;
};

type LearningOverview = {
  questionCount: number;
  explainedQuestionCount: number;
  theoryCount: number;
  questionMeta: Array<{
    id: number;
    category: string;
    topic: string;
    examScope: string;
    kind: string;
  }>;
  byExam: Record<ExamType, CourseOverviewStats>;
};

export type TheoryProgressRecord = {
  id: number;
  theoryId: number;
  examType: ExamType;
  completed: boolean;
};

export type StudyData = {
  questions: Question[];
  theories: TheoryArticle[];
  attempts: Attempt[];
  examSessions: ExamSession[];
  evaluations: StoredEvaluation[];
  theoryProgress: TheoryProgressRecord[];
  settings: { selectedExam: ExamType };
  site: {
    notice: string;
    maintenanceMode: boolean;
    defaultExamMode: ExamType;
  };
  adminAccess: boolean;
  overview?: LearningOverview;
  practiceMeta?: {
    counts: Array<{
      category: string;
      difficulty: string;
      kind: string;
      count: number;
      eligibleGroupCount: number;
    }>;
    summary: { questionCount: number; eligibleGroupCount: number };
  };
  theoryNavigation?: {
    linkedCount: number;
    previous: TheoryArticle | null;
    next: TheoryArticle | null;
  };
  recordsPagination?: {
    attemptsNextCursor: number | null;
    bookmarksNextCursor: number | null;
    limit: number;
  };
  recordsSummary?: {
    incorrectQuestionCount: number;
    bookmarkCount: number;
  };
  recordStats?: {
    totalAttempts: number;
    correctAttempts: number;
    incorrectAttempts: number;
    learningDays: number;
    difficulties: Array<{ level: string; attempts: number; correct: number; incorrect: number }>;
    categories: Array<{
      category: string;
      attempts: number;
      correct: number;
      incorrect: number;
      topics: Array<{ topic: string; attempts: number; correct: number; incorrect: number }>;
    }>;
  };
  mockPagination?: { hasMore: boolean; limit: number };
};

export const CATEGORIES: string[] = [...SUBJECTS];
const SUBJECT3_THEORY_TOPICS = [
  "SQL 처리 과정",
  "옵티마이저",
  "SQL 파싱과 최적화",
  "실행계획",
  "SQL 성능 문제 진단",
  "인덱스 기본 원리",
  "인덱스 스캔 방식",
  "테이블 액세스 최소화",
  "통계정보",
  "조인 순서와 조인 방식",
  "NL 조인",
  "소트 머지 조인",
  "해시 조인",
  "소트 튜닝",
  "스칼라 서브쿼리",
  "고급 SQL 활용",
  "서브쿼리와 조인 변환",
  "옵티마이저 쿼리 변환",
  "파티셔닝",
  "병렬 처리",
  "DML 튜닝",
  "트랜잭션",
  "Lock",
  "동시성 제어",
  "데이터베이스 Call 최소화",
  "데이터베이스 아키텍처",
] as const;

export const SUBCATEGORIES: Record<string, string[]> = {
  "데이터 모델링의 이해": [
    "데이터 모델의 이해", "엔터티, 속성, 관계", "식별자", "정규화와 반정규화",
    "관계와 조인의 이해", "모델이 표현하는 트랜잭션", "NULL 속성", "본질식별자와 인조식별자",
  ],
  "SQL 기본 및 활용": [
    "관계형 데이터베이스와 SQL", "SELECT 문", "함수", "WHERE 절", "GROUP BY와 HAVING",
    "ORDER BY", "조인", "표준 조인", "서브쿼리", "집합 연산자", "그룹 함수", "윈도우 함수",
    "Top N 쿼리", "계층형 질의", "셀프 조인", "PIVOT과 UNPIVOT", "정규 표현식",
    "DML", "TCL", "DDL", "DCL", "SQL 최적화 기본 원리",
  ],
  "SQL 고급 활용 및 튜닝": [
    ...SUBJECT3_THEORY_TOPICS,
  ],
};

export function directlyLinkedQuestions(questions: Question[], article: TheoryArticle) {
  return questions.filter((question) => question.theoryId === article.id);
}

export function resolvedTopic(question: Question) {
  return canonicalTopicLabel(question.category, question.topic, question.theoryId);
}

export function normalizedSearchTokens(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

export function matchesSearchQuery(query: string, ...values: unknown[]) {
  const tokens = normalizedSearchTokens(query);
  if (!tokens.length) return true;
  const searchableText = values
    .map((value) => String(value ?? ""))
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/gu, " ");
  return tokens.every((token) => searchableText.includes(token));
}

const loadMarkdownRenderer = () => import("@frontend/features/content/components/markdown-renderer");
const LazyMarkdownRenderer = lazy(loadMarkdownRenderer);

export function preloadMarkdownRenderer() {
  return loadMarkdownRenderer();
}

export function RichContent({ value, compact = false, explanation = false, choiceValue = false }: {
  value: string;
  compact?: boolean;
  explanation?: boolean;
  choiceValue?: boolean;
}) {
  // The index badge and a one-character symbol answer are different things.
  // Prefix only a complete literal symbol; keep the stored choice untouched.
  const normalizedValue = useMemo(
    () => explanation
      ? normalizeExplanationMarkdown(value)
      : normalizeMarkdownProse(stripProblemApplicationSection(value)),
    [explanation, value],
  );
  const displayValue = choiceValue && /^[①-⑩]$/u.test(value.trim()) ? `기호 ${value.trim()}` : normalizedValue;
  return (
    <div className={compact ? "rich-content compact" : "rich-content"}>
      <div className="markdown-body">
        <RetryBoundary fallbackTitle="학습 내용 표시 중 오류가 발생했습니다." resetKey={displayValue}>
          <Suspense fallback={<span className="sr-only" role="status">학습 내용을 불러오는 중입니다.</span>}>
            <LazyMarkdownRenderer value={displayValue} />
          </Suspense>
        </RetryBoundary>
      </div>
    </div>
  );
}

export function reviewQuestionLabel(value: string) {
  return normalizeMarkdownProse(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[*_~`>#]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function theoryTocItems(content: string) {
  return markdownHeadingEntries(learnerFacingMarkdown(content))
    .filter(({ level }) => level >= 2)
    .slice(0, 12)
    .map(({ id, label }) => ({
      id,
      label: label.replace(/^\s*(?:제\s*)?\(?\d+\)?(?:\.\d+)*\s*(?:장|절|[.)\-:])?\s+/u, "").trim() || label,
    }));
}

type TheoryLearningArticle = Pick<
  TheoryArticle,
  "id" | "category" | "content" | "reviewAnswers"
>;

export function TheoryLearningContent({
  article,
  modal = false,
}: {
  article: TheoryLearningArticle;
  modal?: boolean;
}) {
  const parsed = useMemo(
    () => splitTheoryReview(
      stripTheoryDifficultyMetadata(article.content),
      article.reviewAnswers,
    ),
    [article.content, article.reviewAnswers],
  );
  return (
    <>
      <div className={modal ? "theory-modal-content" : "theory-content"}>
        <RichContent
          value={parsed.mainContent}
        />
      </div>
      {parsed.items.length > 0 && (
        <section className="theory-review" aria-labelledby={`theory-review-${article.id}`}>
          <div className="theory-review-heading">
            <span className="eyebrow">스스로 확인하기</span>
            <h3 id={`theory-review-${article.id}`}>개념 확인 문제</h3>
            <p>문제를 누르면 바로 아래에서 정답과 해설을 확인할 수 있습니다.</p>
          </div>
          <div className="theory-review-list">
            {parsed.items.map((item) => (
              <details className="theory-review-item" key={`${article.id}-${item.number}`}>
                <summary>
                  <span className="theory-review-number">{String(item.number).padStart(2, "0")}</span>
                  <span>{reviewQuestionLabel(item.question)}</span>
                  <span className="theory-review-toggle" aria-hidden="true">＋</span>
                </summary>
                <div className="theory-review-answer">
                  <strong>정답 및 해설</strong>
                  <RichContent value={item.answer} compact />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <section className="card empty-state"><span>□</span><h2>{title}</h2><p>{description}</p></section>;
}

function questionDisplayParts(value: string) {
  return splitQuestionPromptForDisplay(value);
}

export function contentSummary(value: string, max = 110) {
  const summary = questionDisplayParts(value).stem
    .replace(/```[a-zA-Z0-9_-]*\r?\n[\s\S]*?```/g, " [SQL·코드 포함] ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return summary.length > max ? `${summary.slice(0, max).trimEnd()}…` : summary;
}

export function QuestionPromptContent({ value }: { value: string }) {
  const { stem, details } = useMemo(() => questionDisplayParts(value), [value]);
  return (
    <div className="question-content">
      <div className="question-stem"><RichContent value={stem} /></div>
      {details && (
        <section className="question-condition-block">
          <strong>주요 조건 및 자료</strong>
          <RichContent value={details} />
        </section>
      )}
    </div>
  );
}

export function sameAnswers(a: number[], b?: number[]) {
  return Boolean(b?.length)
    && [...a].sort((x, y) => x - y).join(",") === [...b!].sort((x, y) => x - y).join(",");
}

export { koreaDateKey, dateTimeLabel } from "@shared/date/korea-date.mjs";

export function selfAssessmentVerdict(score: number): DescriptiveEvaluation["result"] {
  if (score >= 80) return "correct";
  if (score >= 40) return "partial";
  return "incorrect";
}

export function descriptiveGuidance(question: Question) {
  const normalized = stripProblemApplicationSection(question.explanation)
    .replace(/^\s*#{1,6}\s*모범답안(?:과 상세 해설)?\s*/u, "")
    .trim();
  const marker = /(?:^|\n)\s*(?:#{2,4}\s*(?:핵심\s*)?해설|\*\*해설의 핵심\*\*)\s*(?:\n|$)/u;
  const match = marker.exec(normalized);
  const modelAnswer = (match ? normalized.slice(0, match.index) : normalized).trim();
  const detailedExplanation = (match
    ? normalized.slice(match.index + match[0].length)
    : question.requiredConcepts.length
      ? `답안에 포함해야 할 핵심 개념입니다.\n\n${question.requiredConcepts.map((item) => `- ${item}`).join("\n")}`
      : "모범답안의 요구사항, SQL과 판단 근거를 순서대로 대조해 보세요."
  ).trim();
  return { criteria: question.scoringCriteria, modelAnswer, detailedExplanation };
}

export function createSelfEvaluation(question: Question, score: number): DescriptiveEvaluation {
  const guidance = descriptiveGuidance(question);
  return {
    result: selfAssessmentVerdict(score),
    score,
    feedback: "평가 기준과 모범답안을 비교해 직접 기록한 예상 점수입니다.",
    modelAnswer: guidance.modelAnswer,
    detailedExplanation: guidance.detailedExplanation,
    provider: "self",
  };
}

export function DescriptiveGuidance({ question }: { question: Question }) {
  const guidance = descriptiveGuidance(question);
  return <section className="descriptive-guidance"><div><span className="eyebrow">평가 자료</span><h3>평가 기준</h3>{question.examScope === "IPEP" && <p>여러 입력칸이 있는 문제는 맞힌 항목 수에 따라 5점을 균등하게 나눕니다. 아래 원본 배점 안내는 참고용이며, 이 사이트의 학습용 부분점수 기준을 적용합니다.</p>}{guidance.criteria.length ? <ul>{guidance.criteria.map((item) => <li key={item}>{item}</li>)}</ul> : <p>문제의 요구사항을 빠짐없이 충족했는지 확인하세요.</p>}</div><div><h3>모범답안</h3><RichContent value={guidance.modelAnswer} /></div><div><h3>상세 해설</h3><RichContent value={guidance.detailedExplanation} /></div></section>;
}

export function SelfAssessmentSummary({ evaluation }: { evaluation: DescriptiveEvaluation }) {
  if (evaluation.provider === "exact") return <section className={`self-assessment-summary ${evaluation.result}`} role="status"><div><span>{evaluation.result === "correct" ? "정답" : evaluation.result === "partial" ? "부분 정답" : "오답"}</span><strong>{Number((evaluation.score / 100 * 5).toFixed(2))} / 5점</strong></div><p>{evaluation.feedback}</p>{evaluation.answerParts && <ol className="practical-part-results">{evaluation.answerParts.map((part, i) => <li key={i}>{part.label} · {part.correct ? "정답" : "오답·미입력"}</li>)}</ol>}</section>;
  return <section className="evaluation-card self-evaluation-card"><div><span className={`evaluation-result ${evaluation.result}`}>{evaluation.result === "correct" ? "충분" : evaluation.result === "partial" ? "부분 충족" : "보완 필요"}</span><strong>내 예상 점수 {evaluation.score}점</strong></div><p>{evaluation.feedback}</p></section>;
}

export function answerLetters(values: number[]) {
  return values.length ? values.map((index) => choiceLabel(index)).join(", ") : "미응답";
}
