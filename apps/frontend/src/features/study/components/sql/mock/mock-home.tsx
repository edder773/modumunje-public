"use client";

import { useState } from "react";
import { PRACTICAL_PAST_EXAMS_PUBLISHED, PRACTICAL_PAST_FORMS, isHiddenPracticalPastQuestion } from "@shared/study/ipe-practical-past.mjs";
import {
  EXAM_CONFIGS,
  examDisplayName,
  type ExamResult,
  type ExamType,
} from "@shared/study/study-domain";
import {
  dateTimeLabel,
  type ExamSession,
} from "../../study-screen-shared";

export function MockExamHome({ examType, sessions, busy, error, onStart, onStartPast, onResume }: {
  examType: ExamType;
  sessions: ExamSession[];
  busy: boolean;
  error: { message: string; shortages?: Array<{ label: string; required: number; available: number }> } | null;
  onStart: () => void;
  onStartPast?: (formId: string) => void;
  onResume: (session: ExamSession) => void;
}) {
  const [pastYear, setPastYear] = useState("전체");
  const config = EXAM_CONFIGS[examType];
  if (!config) return <section className="card"><h2>{examDisplayName(examType)} 모의고사 준비 중</h2><p>문제와 채점 기준 검토를 마친 뒤 공개합니다.</p></section>;
  const isPractical = examType === "IPEP";
  const examName = examDisplayName(examType);
  const objectiveCount = Object.values(config.objectiveCounts)
    .reduce<number>((total, count) => total + Number(count ?? 0), 0);
  const examSessions = sessions.filter((session) => session.examType === examType
    && !session.questionIds.some(isHiddenPracticalPastQuestion)
    && (PRACTICAL_PAST_EXAMS_PUBLISHED || !session.examForm));
  const allSubmitted = examSessions.filter((session) => session.status === "submitted");
  const submitted = allSubmitted.filter(session => !session.examForm);
  const active = examSessions.find((session) => session.status === "active");
  const latest = submitted[0];
  const scores = submitted.map((session) => Number((session.result as ExamResult).totalScore ?? 0));
  return (
    <div className="page-stack mock-home">
      <section className="mock-intro"><div><span className="section-kicker">{examName} 실전 모의고사</span><h2>시간을 정해 학습 모의고사에 응시하세요.</h2><p>모두의 문제집이 자체 구성한 학습용 모의고사입니다. 문항 구성·시간·채점 기준은 아래 안내를 따릅니다. 현재 선택한 {examName} 시험만 구성하며, 답안과 종료 시각은 자동 저장되어 브라우저를 닫아도 시험시간이 계속 흐릅니다.</p></div></section>
      {error && <section className="card exam-shortage" role="alert"><strong>{error.message}</strong>{error.shortages?.map((item) => <p key={item.label}>{item.label} 필요: {item.required}문항 / 사용 가능: {item.available}문항</p>)}</section>}
      <section className="practice-setup mock-setup">
        <div className="exam-card-grid"><article className="card exam-select-card">
          <div className="exam-card-head"><span>{examName}</span><strong>{isPractical ? "무작위 실기 모의고사" : config.title}</strong></div>
          <dl><div><dt>시험시간</dt><dd>{config.durationMinutes}분</dd></div><div><dt>총 문항</dt><dd>{config.totalQuestions}문항</dd></div><div><dt>문제 유형</dt><dd>{isPractical ? `단답형 ${config.descriptiveCount}문항` : config.descriptiveCount ? `객관식 ${objectiveCount} + 실기형·서술형 ${config.descriptiveCount}` : `객관식 ${objectiveCount}`}</dd></div><div><dt>합격 기준</dt><dd>{config.passingScore}점 이상{config.subjectMinimumRate > 0 ? ` · 과목별 ${config.subjectMinimumRate}%` : ""}{config.practicalMinimumRate ? ` · 실기 ${config.practicalMinimumRate}%` : ""}</dd></div></dl>
          {isPractical && <p className="practical-mock-guidance">검토된 실기 문제에서 20문항을 무작위로 구성합니다. 문항당 5점이며, 여러 답은 항목별 입력칸에 작성합니다. 맞힌 항목마다 5점/항목 수의 부분점수를 부여하고, 제출 후 채점 결과를 확인할 수 있습니다.</p>}
          <div className="exam-subjects">{Object.entries(config.objectiveCounts).map(([subject, count]) => <span key={subject}>{subject} {count}문항</span>)}</div>
          {submitted.length > 0 && <div className="exam-history"><span>최근 {dateTimeLabel(latest.submittedAt)}{(latest.result as ExamResult).autoSubmitted ? " · 자동 제출" : ""}</span><strong>최근 {Number((latest.result as ExamResult).totalScore ?? 0)}점 · 최고 {Math.max(...scores)}점</strong><span>{submitted.length}회 응시 · {(latest.result as ExamResult).passed ? "최근 합격" : "최근 불합격"}</span></div>}
          <div className="exam-card-actions">{active && <button className="outline-button" onClick={() => onResume(active)}>{active.examForm ? `${active.examForm.title} 이어 풀기` : "진행 중 시험 이어서"}</button>}<button className="primary-button" onClick={onStart} disabled={busy || Boolean(active)}>{busy ? "준비 중…" : "새 시험 시작"}</button></div>
        </article></div>
        <aside className="study-tip"><span>TIP</span><h3>시험 진행은 자동 저장됩니다.</h3><p>화면을 이동하거나 다시 접속해도 선택한 시험의 답안과 남은 시간을 복구할 수 있습니다. 다른 시험의 진행 기록은 섞이지 않습니다.</p></aside>
      </section>
      {isPractical && PRACTICAL_PAST_EXAMS_PUBLISHED && <section className="past-exam-section" aria-labelledby="past-exam-title">
        <div className="past-exam-heading"><div><span className="section-kicker">연도·회차별 기출 복원</span><h2 id="past-exam-title">기출문제 모의고사</h2><p>2020년 1회부터 2026년 1회까지, 20개 회차를 따로 응시할 수 있습니다.</p></div>
          <label>출제 연도<select value={pastYear} onChange={event => setPastYear(event.target.value)}><option value="전체">전체 연도</option>{[...new Set(PRACTICAL_PAST_FORMS.map(form => form.year))].reverse().map(year => <option key={year} value={year}>{year}년</option>)}</select></label>
        </div>
        <p className="past-exam-guide">회차별 20문항 · 150분 · 새 응시마다 문제 순서 무작위 · 이어 풀기는 저장 순서 유지</p>
        <div className="past-exam-grid">{[...PRACTICAL_PAST_FORMS].reverse().filter(form => pastYear === "전체" || String(form.year) === pastYear).map(form => {
          const history = allSubmitted.filter(session => session.examForm?.id === form.id);
          const recent = history[0];
          const continuing = active?.examForm?.id === form.id;
          return <article className="card past-exam-card" key={form.id}>
            <h3>{form.title}</h3><span>정보처리기사 실기 · 20문항</span>
            <p>{recent ? `최근 ${Number(recent.result.totalScore ?? 0)}점 · 최근 기록 ${history.length}회` : "최근 응시 기록이 없습니다."}</p>
            {form.note && <p className="past-exam-source-note">{form.note}</p>}
            <div className="exam-card-actions">
              {continuing && active ? <button className="primary-button" disabled={busy} onClick={() => onResume(active)}>이어서 풀기</button> : <button className="primary-button" disabled={busy || Boolean(active) || !onStartPast} onClick={() => onStartPast?.(form.id)} aria-label={`${form.title} 기출 모의고사 시작`}>응시하기</button>}
              {recent && <button className="outline-button" disabled={busy} onClick={() => onResume(recent)} aria-label={`${form.title} 최근 결과 보기`}>최근 결과</button>}
            </div>
          </article>;
        })}</div>
        <p className="past-exam-guide">응시 기록은 최근 20회 기준입니다. 첨부 복원 자료의 오류를 보정하고 정답·해설을 보강했습니다. 여러 답은 항목별로 입력하며, 문항당 5점을 항목 수로 균등 배분해 부분점수를 적용합니다. 학습용 채점 기준입니다. 서술 답안은 등록한 핵심 표현으로 판정하며 결과에서 해설과 비교할 수 있습니다.</p>
      </section>}
    </div>
  );
}

export default MockExamHome;
