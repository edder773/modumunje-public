"use client";

import {
  type ExamType,
} from "@shared/study/study-domain";
import {
  CONTENT_CATALOG_META,
  learningCourse,
  learningPath,
} from "@shared/study/learning-catalog";
import RoutedLink from "../../routed-link";
import {
  type View,
} from "../../study-screen-shared";

export function Dashboard({
  examType,
  questionCount,
  theoryCount,
  explainedQuestionCount,
  onStart,
  onNavigate,
}: {
  examType: ExamType;
  questionCount: number;
  theoryCount: number;
  explainedQuestionCount: number;
  onStart: () => void;
  onNavigate: (view: View) => void;
}) {
  const course = learningCourse(examType);
  const contentKinds = new Set(course.contentKinds);
  const questionScale = contentScale(questionCount, 100);
  const theoryScale = contentScale(theoryCount, 10);
  const reviewedAt = CONTENT_CATALOG_META.reviewedAt.replaceAll("-", ".");
  const learningActions: Array<{
    icon: string;
    title: string;
    description: string;
    meta: string;
    actionLabel: string;
    href: string;
    onClick: () => void;
  }> = [
    ...(contentKinds.has("question") ? [{
      icon: "문제",
      title: "문제 풀이",
      description: `${course.name} 과목과 난이도를 선택해 원하는 만큼 문제를 풉니다.`,
      meta: "정답·해설 바로 확인",
      actionLabel: "문제 풀기 →",
      href: learningPath({ examType, page: "practice" }),
      onClick: onStart,
    }] : []),
    ...(contentKinds.has("theory") ? [{
      icon: "이론",
      title: "이론 학습",
      description: "과목과 단원 순서에 따라 핵심 개념과 시험 판단 기준을 학습합니다.",
      meta: "과목·단원별 핵심 이론",
      actionLabel: "이론 보기 →",
      href: learningPath({ examType, page: "theories" }),
      onClick: () => onNavigate("theory"),
    }] : []),
    ...(contentKinds.has("mock-exam") ? [{
      icon: "시험",
      title: "모의고사",
      description: `${course.name} 시험 구성에 맞춘 ${course.mockExam} 실전 학습입니다.`,
      meta: `${course.name} 실전 구성`,
      actionLabel: "모의고사 보기 →",
      href: learningPath({ examType, page: "mock-exams" }),
      onClick: () => onNavigate("mock"),
    }] : []),
    ...(contentKinds.has("question") ? [{
      icon: "기록",
      title: "학습 기록",
      description: "풀이 기록, 오답 문제, 북마크와 모의고사 결과를 한곳에서 확인합니다.",
      meta: "기록·복습 통합",
      actionLabel: "기록 보기 →",
      href: learningPath({ examType, page: "records" }),
      onClick: () => onNavigate("stats"),
    }] : []),
  ];
  return (
    <div className="page-stack dashboard-home learning-entry-page">
      <section className="learning-actions-section" aria-labelledby="learning-actions-title">
        <div className="section-heading entry-section-heading">
          <div>
            <span className="section-kicker">학습 기능</span>
            <h2 id="learning-actions-title">원하는 방식으로 학습하세요.</h2>
            <p>현재 선택한 {course.name} 과정 기준으로 이동합니다.</p>
          </div>
        </div>
        <div className="learning-action-grid">
          {learningActions.map((action) => (
            <TopicCard key={action.title} {...action} />
          ))}
        </div>
      </section>

      <section className="card content-trust" aria-labelledby="content-trust-title">
        <div>
          <span className="section-kicker">콘텐츠 기준</span>
          <h2 id="content-trust-title">검수된 범위 안에서 학습합니다.</h2>
          <p>실제 제공 중인 콘텐츠 기준이며 내부 문제은행의 정확한 전체 수량은 공개하지 않습니다.</p>
        </div>
        <dl>
          {contentKinds.has("question") && <div><dt>문제 규모</dt><dd>{questionScale}</dd></div>}
          <div><dt>이론 규모</dt><dd>{theoryScale}</dd></div>
          {contentKinds.has("question") ? <div>
            <dt>해설</dt>
            <dd>{questionCount > 0 && explainedQuestionCount === questionCount
              ? "모든 문항 제공"
              : "문항별 제공"}</dd>
          </div> : <div><dt>학습 구성</dt><dd>핵심 개념·판단 기준</dd></div>}
          <div><dt>공개 범위</dt><dd>{course.subjects.map((subject) => subject.name).join("·")}</dd></div>
          <div><dt>최근 검수 반영</dt><dd>{course.fieldId === "sql" ? reviewedAt : questionCount || theoryCount ? "등록 데이터 기준" : "콘텐츠 등록 대기"}</dd></div>
        </dl>
      </section>
    </div>
  );
}
function contentScale(count: number, step: number) {
  if (count < step) return `${count.toLocaleString("ko-KR")}개`;
  const rounded = Math.floor(count / step) * step;
  return `${rounded.toLocaleString("ko-KR")}개 이상`;
}

function TopicCard({ icon, title, description, meta, actionLabel, href, onClick }: { icon: string; title: string; description: string; meta: string; actionLabel: string; href: string; onClick: () => void }) {
  return (
    <RoutedLink className="card topic-card" href={href} onNavigate={onClick}>
      <span className="topic-icon" aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="topic-meta"><span>{meta}</span><strong>{actionLabel}</strong></div>
    </RoutedLink>
  );
}

export default Dashboard;
