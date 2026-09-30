import { PRACTICAL_PAST_EXAMS_PUBLISHED, findPracticalPastForm, shuffledExamQuestions } from "@shared/study/ipe-practical-past.mjs";
import { hasPracticalAnswer } from "@shared/study/practical-answer-fields";
import { courseContentKinds, isReleasedExamType } from "@shared/study/course-registry";
import { guestExamQuotaReached, isGuestLearningKey } from "@backend/common/auth/guest-learning-session";
import {
  dedupeCanonicalQuestions,
  isCanonicalPracticeQuestion,
  isGeneralPracticeQuestion,
} from "@shared/content/question-pool.mjs";
import {
  buildExamResultBreakdown,
  EXAM_CONFIGS,
  examDisplayName,
  isDescriptiveAllowed,
  isObjectiveKind,
  questionAllowedForExam,
  resolvedExamConfig,
  rounded,
  selfAssessmentVerdict,
  type DescriptiveEvaluation,
  type ExamResult,
  type ExamType
} from "./domain/study.domain";
import {
  StudyRequestError
} from "./study-attempt.service";
import {
  questionRowsByIds
} from "./study-question-delivery";
import {
  changedExamItemState,
  mockQuestionWindow,
  parseExamSession,
  type SessionWithItems
} from "./study-session.domain";
import {
  StudyRepository,
  type AttemptInsert,
  type ExamCandidateMetadataRow
} from "./study.repository";


import { EXAM_GRADING_LEASE_MS, examType, list, now, numberList, PRIVATE_CACHE_CONTROL, type JsonRecord } from "./study-request-values";

import { sessionForUser } from "./study-owned-session";
import { gradePracticalAnswer, practicalAnswerInput } from "./ipe-practical-grading";

export function createStudyExamUseCases(studyRepository: StudyRepository) {
  const shuffled = shuffledExamQuestions;

  type ExamCandidate = Omit<ExamCandidateMetadataRow, "choices"> & {
    active: true;
    choices: string[];
  };

  function validObjective(row: ExamCandidate) {
    return isObjectiveKind(row.kind)
      && row.choices.length >= 2;
  }

  async function startExam(key: string, selectedExam: ExamType, adminActivity: boolean, formId?: unknown, recordGuestAnalytics = true) {
    if (!isReleasedExamType(selectedExam) || !courseContentKinds(selectedExam).includes("mock-exam") || !EXAM_CONFIGS[selectedExam]) {
      throw new StudyRequestError(409, "모의고사를 준비하고 있는 과정입니다.", "exam policy pending", "EXAM_POLICY_PENDING");
    }
    const selectedForm = findPracticalPastForm(formId);
    if (formId !== undefined && (selectedExam !== "IPEP" || !selectedForm)) {
      throw new StudyRequestError(400, "선택한 기출 회차를 확인할 수 없습니다.", "invalid past exam form", "EXAM_FORM_INVALID");
    }
    if (selectedForm && !PRACTICAL_PAST_EXAMS_PUBLISHED) {
      throw new StudyRequestError(404, "현재 제공하지 않는 모의고사입니다.", "past exams are administrator-only", "EXAM_FORM_UNAVAILABLE");
    }
    if (selectedExam === "IPEP" && !PRACTICAL_PAST_EXAMS_PUBLISHED) {
      await studyRepository.releaseHiddenExamLease(key, selectedExam);
    }
    function requireSameForm(session: ReturnType<typeof parseExamSession>) {
      if (selectedExam === "IPEP" && session.examForm?.id !== selectedForm?.id) {
        throw new StudyRequestError(409, `진행 중인 ${session.examForm?.title ?? "무작위 실기"} 시험을 먼저 이어서 풀거나 제출해 주세요.`, "different active practical form", "EXAM_FORM_CONFLICT");
      }
    }
    const existing = await studyRepository.findActiveExamSession(key, selectedExam);
    if (existing && Date.parse(existing.endsAt) > Date.now()) {
      const resumed = {
        ...existing,
        items: await studyRepository.findSessionItems(existing.id),
      };
      const parsed = parseExamSession(resumed);
      requireSameForm(parsed);
      return Response.json({
        session: parsed,
        questions: await questionRowsByIds(
          studyRepository,
          mockQuestionWindow(parsed.questionIds, parsed.currentIndex),
          key,
        ),
        resumed: true,
      }, { headers: { "Cache-Control": PRIVATE_CACHE_CONTROL } });
    }
    if (existing) {
      await submitExam(key, { sessionId: existing.id }, recordGuestAnalytics).catch(() => undefined);
    }
    if (await guestExamQuotaReached(key, "sql")) {
      throw new StudyRequestError(429, "비회원 시험 생성 한도에 도달했습니다. 기존 시험을 이어서 이용하거나 로그인해 주세요.", "guest exam quota", "GUEST_EXAM_LIMIT");
    }
    const rows: ExamCandidate[] = (await studyRepository.findExamCandidateMetadata(
      selectedExam,
    )).map((row) => ({
      ...row,
      active: true,
      choices: list(row.choices).map(String),
    }));
    const config = selectedExam === "IPEP" ? { ...EXAM_CONFIGS[selectedExam],
      ...(selectedForm ? { title: `정보처리기사 실기 · ${selectedForm.title}` } : {}),
      policyVersion: `${selectedForm?.id ?? EXAM_CONFIGS.IPEP.policyVersion}-equal-parts-v1`, resultDecimals: 2,
    } : EXAM_CONFIGS[selectedExam];
    if (!config) throw new StudyRequestError(409, "모의고사를 준비하고 있는 과정입니다.", "exam policy pending", "EXAM_POLICY_PENDING");
    const eligible = (selectedForm ? rows.filter(q => selectedForm.questionIds.includes(q.id)) : dedupeCanonicalQuestions(shuffled(rows))).filter((question) => (
      questionAllowedForExam(question, selectedExam)
      && (selectedForm || isGeneralPracticeQuestion(question))
      && isCanonicalPracticeQuestion(question)
      && (selectedExam !== "IPEP" || Boolean(practicalAnswerInput(question.id, question.examScope)))
    ));
    const selected: number[] = [];
    const shortages: Array<{ label: string; required: number; available: number }> = [];

    for (const [subject, required] of Object.entries(config.objectiveCounts)) {
      const candidates = eligible.filter((question) => question.category === subject && validObjective(question));
      if (candidates.length < Number(required)) {
        shortages.push({ label: subject, required: Number(required), available: candidates.length });
      } else {
        selected.push(...shuffled(candidates).slice(0, Number(required)).map((question) => question.id));
      }
    }

    if (config.descriptiveCount) {
      const candidates = shuffled(eligible.filter((question) =>
        question.kind === "descriptive"
        && isDescriptiveAllowed(selectedExam, question.category)));
      if (candidates.length < config.descriptiveCount) {
        shortages.push({ label: "실기형·서술형", required: config.descriptiveCount, available: candidates.length });
      } else {
        selected.push(...candidates.slice(0, config.descriptiveCount).map((question) => question.id));
      }
    }

    if (shortages.length) {
      return Response.json({
        error: `${examDisplayName(selectedExam)} 모의고사를 시작할 수 없습니다.`,
        shortages,
      }, { status: 409 });
    }

    if (selectedForm) {
      if (selected.length !== 20 || selectedForm.questionIds.some(id => !selected.includes(id))) {
        throw new StudyRequestError(409, "회차의 20문항을 모두 준비하지 못했습니다.", "past form incomplete", "EXAM_QUESTION_UNAVAILABLE");
      }
      const raw = await studyRepository.findFeedbackQuestionsByIds(selected);
      if (raw.length !== 20 || (await Promise.all(raw.map(q => gradePracticalAnswer(q, "")))).some(grade => !grade)) {
        throw new StudyRequestError(409, "회차의 정답 기준을 확인 중입니다. 잠시 후 다시 시도해 주세요.", "past policy unavailable", "STUDY_ANSWER_POLICY_STALE");
      }
    }
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + config.durationMinutes * 60_000);
    const id = crypto.randomUUID();
    const stored = await studyRepository.insertExamSessionWithLease({
      id,
      userKey: key,
      examType: selectedExam,
      status: "active",
      questionIds: JSON.stringify(selected),
      answers: "{}",
      descriptiveAnswers: "{}",
      descriptiveScores: "{}",
      descriptiveSnapshots: "{}",
      flagged: "[]",
      currentIndex: 0,
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      policyVersion: config.policyVersion,
      policySnapshot: JSON.stringify(config),
      isAdmin: adminActivity,
      updatedAt: startedAt.toISOString(),
    }, selected);
    const session = {
      ...stored.session,
      items: await studyRepository.findSessionItems(stored.session.id),
    };
    const parsed = parseExamSession(session);
    requireSameForm(parsed);
    return Response.json({
      session: parsed,
      questions: await questionRowsByIds(studyRepository, mockQuestionWindow(parsed.questionIds, 0), key),
      resumed: !stored.created,
    }, { status: stored.created ? 201 : 200, headers: { "Cache-Control": PRIVATE_CACHE_CONTROL } });
  }

  function recordValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  function sanitizedExamState(session: SessionWithItems, payload: JsonRecord) {
    const parsed = parseExamSession(session);
    const questionIds = parsed.questionIds;
    const allowedIds = new Set(questionIds.map(String));
    const storedAnswers = parsed.answers;
    const storedDescriptiveAnswers = parsed.descriptiveAnswers;
    const storedScores = parsed.descriptiveScores;
    const storedSnapshots = parsed.descriptiveSnapshots;
    const incomingAnswers = recordValue(payload.answers);
    const incomingDescriptiveAnswers = recordValue(payload.descriptiveAnswers);
    const incomingScores = recordValue(payload.descriptiveScores);
    const incomingSnapshots = recordValue(payload.descriptiveSnapshots);
    const answerSource = incomingAnswers ?? storedAnswers;
    const descriptiveSource = incomingDescriptiveAnswers ?? storedDescriptiveAnswers;
    const scoreSource = incomingScores ?? storedScores;
    const answers: Record<string, number[]> = {};
    const descriptiveAnswers: Record<string, string> = {};
    const descriptiveScores: Record<string, number> = {};
    const descriptiveSnapshots: Record<string, string> = {};

    for (const id of allowedIds) {
      if (session.examType === "IPEP") {
        const value = descriptiveSource[id];
        if (value !== undefined && typeof value !== "string") {
          throw new StudyRequestError(400, "실기 답안은 텍스트로 입력해 주세요.");
        }
        const answer = value ?? "";
        if (new TextEncoder().encode(answer).byteLength > 16_384) {
          throw new StudyRequestError(400, "실기 답안이 너무 깁니다. 문항에서 요구한 답만 입력해 주세요.");
        }
        // Output questions can depend on spaces and line breaks. Only the server
        // supplies scores, and no answer is locked or revealed while taking the exam.
        if (answer) descriptiveAnswers[id] = answer;
        continue;
      }
      const selected = numberList(answerSource[id]);
      if (selected.length) answers[id] = selected;

      const storedSnapshot = String(storedSnapshots[id] ?? "").trim();
      const submittedAnswer = String(descriptiveSource[id] ?? "");
      const submittedSnapshot = String(incomingSnapshots?.[id] ?? "").trim();
      const snapshot = storedSnapshot
        || (submittedSnapshot && submittedAnswer.trim() === submittedSnapshot ? submittedSnapshot : "");
      if (snapshot) {
        descriptiveSnapshots[id] = snapshot;
        descriptiveAnswers[id] = snapshot;
        const score = Number(scoreSource[id]);
        if (Number.isFinite(score) && score >= 0 && score <= 100) {
          descriptiveScores[id] = Math.round(score);
        }
      } else if (submittedAnswer) {
        descriptiveAnswers[id] = submittedAnswer;
      }
    }

    return {
      answers,
      descriptiveAnswers,
      descriptiveScores,
      descriptiveSnapshots,
      flagged: numberList(payload.flagged ?? parsed.flagged)
        .filter((id) => allowedIds.has(String(id))),
      currentIndex: Math.min(
        Math.max(0, Number(payload.currentIndex) || 0),
        Math.max(0, questionIds.length - 1),
      ),
    };
  }

  async function saveExam(key: string, payload: JsonRecord) {
    const session = await sessionForUser(studyRepository, key, payload.sessionId);
    if (session.status !== "active") return Response.json({ session: parseExamSession(session) });
    if (Date.now() >= Date.parse(session.endsAt)) {
      return Response.json({
        error: "시험 시간이 종료되어 더 이상 답안을 변경할 수 없습니다.",
        code: "EXAM_EXPIRED",
        session: parseExamSession(session),
      }, { status: 409 });
    }
    const expectedRevision = Number(payload.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new StudyRequestError(400, "현재 시험 저장 버전이 필요합니다.", "exam revision is required");
    }
    const state = sanitizedExamState(session, payload);
    const updatedAt = now();
    const nextRevision = expectedRevision + 1;
    const values = {
      answers: JSON.stringify(state.answers),
      descriptiveAnswers: JSON.stringify(state.descriptiveAnswers),
      descriptiveScores: JSON.stringify(state.descriptiveScores),
      descriptiveSnapshots: JSON.stringify(state.descriptiveSnapshots),
      flagged: JSON.stringify(state.flagged),
      currentIndex: state.currentIndex,
      revision: nextRevision,
      updatedAt,
    };
    const saved = await studyRepository.saveExamStateRevision({
      userKey: key,
      sessionId: session.id,
      expectedRevision,
      values,
      items: changedExamItemState(session, state),
    });
    if (!saved) {
      const current = await sessionForUser(studyRepository, key, session.id);
      return Response.json({
        error: "다른 탭이나 기기에서 더 최근 답안이 저장되었습니다. 최신 답안을 확인해 주세요.",
        code: "REVISION_CONFLICT",
        session: parseExamSession(current),
      }, { status: 409 });
    }
    const persisted = { ...session, ...values, items: undefined };
    return Response.json({ session: parseExamSession(persisted) });
  }

  function sameAnswers(first: number[], second: number[]) {
    return [...first].sort((a, b) => a - b).join(",") === [...second].sort((a, b) => a - b).join(",");
  }

  async function submitExam(key: string, payload: JsonRecord, recordGuestAnalytics = true) {
    let existing = await sessionForUser(studyRepository, key, payload.sessionId);
    if (existing.status === "submitted") {
      const session = parseExamSession(existing);
      return Response.json({
        session,
        questions: await questionRowsByIds(studyRepository, session.questionIds, key, true),
      }, { headers: { "Cache-Control": PRIVATE_CACHE_CONTROL } });
    }
    if (existing.status !== "active" && existing.status !== "grading") {
      return Response.json({ error: "시험 제출을 처리하고 있습니다. 잠시 후 다시 확인해 주세요." }, { status: 409 });
    }
    const expired = Date.now() >= Date.parse(existing.endsAt);
    if (existing.status === "active"
      && !expired
      && Object.keys(payload).some((keyName) => keyName !== "sessionId")) {
      const saveResponse = await saveExam(key, payload);
      if (!saveResponse.ok) return saveResponse;
      existing = await sessionForUser(studyRepository, key, existing.id);
    }
    const claimAt = now();
    const staleBefore = new Date(Date.parse(claimAt) - EXAM_GRADING_LEASE_MS).toISOString();
    const storedRow = await studyRepository.claimExamForGrading(
      key,
      existing.id,
      claimAt,
      staleBefore,
    );
    const stored = storedRow
      ? { ...storedRow, items: await studyRepository.findSessionItems(storedRow.id) }
      : null;
    if (!stored) {
      const current = await sessionForUser(studyRepository, key, existing.id);
      if (current.status === "submitted") {
        const session = parseExamSession(current);
        return Response.json({
          session,
          questions: await questionRowsByIds(studyRepository, session.questionIds, key, true),
        }, { headers: { "Cache-Control": PRIVATE_CACHE_CONTROL } });
      }
      return Response.json({ error: "시험 제출을 처리하고 있습니다. 잠시 후 다시 확인해 주세요." }, { status: 409 });
    }

    try {
      const session = parseExamSession(stored);
      const selectedExam = examType(stored.examType);
      const config = resolvedExamConfig(selectedExam, stored.policySnapshot);
      const autoSubmitted = Date.parse(claimAt) >= Date.parse(stored.endsAt);
      const state = sanitizedExamState(stored, autoSubmitted ? {} : payload);
      const answers = state.answers;
      const descriptiveAnswers = state.descriptiveAnswers;
      const descriptiveScores = state.descriptiveScores;
      const descriptiveSnapshots = state.descriptiveSnapshots;
      const rows = await questionRowsByIds(studyRepository, session.questionIds, key, true);
      const byId = new Map(rows.map((question) => [question.id, question]));
      const practicalRows = selectedExam === "IPEP"
        ? new Map((await studyRepository.findFeedbackQuestionsByIds(session.questionIds)).map((question) => [question.id, question]))
        : null;
      const subjectScores: ExamResult["subjectScores"] = {};
      const practicalEvaluations: Record<string, DescriptiveEvaluation> = {};
      const questionResults: ExamResult["questionResults"] = [];
      const attemptRows: AttemptInsert[] = [];
      let objectiveScore = 0;
      let descriptiveScore = 0;
      let practicalFailedMinimum = false;
      let correctCount = 0;
      let incorrectCount = 0;
      let partialCount = 0;
      let unansweredCount = 0;

      for (const [position, id] of session.questionIds.entries()) {
        const question = byId.get(id);
        if (selectedExam === "IPEP") {
          const rawQuestion = practicalRows?.get(id);
          if (!question || !rawQuestion) {
            throw new StudyRequestError(409, "시험 문항을 확인할 수 없어 채점을 완료하지 못했습니다. 답안은 보관되어 있습니다.", "missing practical exam question", "EXAM_QUESTION_UNAVAILABLE");
          }
          const answer = descriptiveAnswers[String(id)] ?? "";
          const grade = await gradePracticalAnswer(rawQuestion, answer);
          if (!grade) {
            throw new StudyRequestError(409, "문항의 정답 기준을 다시 확인해야 합니다. 답안은 보관되어 있으며, 확인 후 다시 제출할 수 있습니다.", `stale practical answer policy: ${id}`, "STUDY_ANSWER_POLICY_STALE");
          }
          const unanswered = !hasPracticalAnswer(answer);
          if (unanswered) unansweredCount += 1;
          else if (grade.correct) correctCount += 1;
          else if (grade.result === "partial") partialCount += 1;
          else incorrectCount += 1;
          const earned = grade.score / 100 * config.descriptivePoint;
          descriptiveScore += earned;
          descriptiveScores[String(id)] = grade.score;
          const aggregate = subjectScores[question.category] ?? { earned: 0, possible: 0, rate: 0, failedMinimum: false };
          aggregate.possible += config.descriptivePoint;
          aggregate.earned += earned;
          subjectScores[question.category] = aggregate;
          practicalEvaluations[String(id)] = {
            result: grade.result, score: grade.score,
            feedback: unanswered ? "답안을 입력하지 않아 0점으로 처리했습니다." : grade.feedback,
            modelAnswer: "", detailedExplanation: question.explanation, provider: "exact",
            ...("answerParts" in grade ? { answerParts: grade.answerParts } : {}),
          };
          questionResults.push({
            questionId: id, position: position + 1, category: question.category,
            kind: question.kind, result: unanswered ? "unanswered" : grade.result,
            score: unanswered ? null : grade.score, convertedScore: earned,
            selectedAnswers: [], correctAnswers: [], choices: [], answerText: answer,
          });
          if (!unanswered) attemptRows.push({
            questionId: id, selectedAnswers: "[]", correct: grade.correct,
            mode: "mock-exam", userKey: key, examType: selectedExam,
            result: grade.result, score: grade.score, answerText: answer,
            evaluationId: null, reviewStatus: grade.correct ? "mastered" : "pending",
            isAdmin: Boolean(stored.isAdmin),
          });
          continue;
        }
        if (!question) continue;
        if (question.kind === "descriptive") {
          const answer = String(descriptiveAnswers[String(id)] ?? "").trim();
          const answerSnapshot = String(descriptiveSnapshots[String(id)] ?? "").trim();
          const rawSelfScore = Number(descriptiveScores[String(id)]);
          const hasSelfScore = Number.isFinite(rawSelfScore)
            && rawSelfScore >= 0
            && rawSelfScore <= 100;
          if (!answer || !answerSnapshot || answer !== answerSnapshot || !hasSelfScore) {
            unansweredCount += 1;
            questionResults.push({
              questionId: id,
              position: position + 1,
              category: question.category,
              kind: question.kind,
              result: "unanswered",
              score: null,
              convertedScore: 0,
              selectedAnswers: [],
              correctAnswers: [],
              choices: [],
              answerText: answer,
            });
            continue;
          }
          const selfScore = Math.round(rawSelfScore);
          if (config.practicalMinimumRate > 0 && selfScore < config.practicalMinimumRate) {
            practicalFailedMinimum = true;
          }
          const verdict = selfAssessmentVerdict(selfScore);
          const evaluation: DescriptiveEvaluation = {
            result: verdict,
            score: selfScore,
            feedback: "평가 기준과 모범답안을 비교해 사용자가 직접 기록한 예상 점수입니다.",
            modelAnswer: "",
            detailedExplanation: question.explanation,
            provider: "self",
          };
          practicalEvaluations[String(id)] = evaluation;
          const converted = Math.min(
            config.descriptivePoint,
            selfScore * (config.descriptivePoint / 100),
          );
          descriptiveScore += converted;
          questionResults.push({
            questionId: id,
            position: position + 1,
            category: question.category,
            kind: question.kind,
            result: evaluation.result,
            score: evaluation.score,
            convertedScore: rounded(converted, config.resultDecimals),
            selectedAnswers: [],
            correctAnswers: [],
            choices: [],
            answerText: answer,
          });
          attemptRows.push({
            questionId: id,
            selectedAnswers: "[]",
            correct: verdict === "correct",
            mode: "mock-exam-self-assessment",
            userKey: key,
            examType: selectedExam,
            result: verdict,
            score: selfScore,
            answerText: answer,
            evaluationId: null,
            reviewStatus: "self-assessed",
            isAdmin: Boolean(stored.isAdmin),
          });
          continue;
        }

        const selected = numberList(answers[String(id)]);
        const possible = config.objectivePoint;
        const aggregate = subjectScores[question.category] ?? { earned: 0, possible: 0, rate: 0, failedMinimum: false };
        aggregate.possible += possible;
        const correct = selected.length > 0 && sameAnswers(selected, question.correctAnswers);
        if (!selected.length) unansweredCount += 1;
        else if (correct) correctCount += 1;
        else incorrectCount += 1;
        if (correct) {
          aggregate.earned += possible;
          objectiveScore += possible;
        }
        questionResults.push({
          questionId: id,
          position: position + 1,
          category: question.category,
          kind: question.kind,
          result: !selected.length ? "unanswered" : correct ? "correct" : "incorrect",
          score: !selected.length ? null : correct ? 100 : 0,
          convertedScore: correct ? possible : 0,
          selectedAnswers: selected,
          correctAnswers: question.correctAnswers,
          choices: question.choices,
          answerText: "",
        });
        subjectScores[question.category] = aggregate;
        if (selected.length) attemptRows.push({
          questionId: id,
          selectedAnswers: JSON.stringify(selected),
          correct,
          mode: "mock-exam",
          userKey: key,
          examType: selectedExam,
          result: correct ? "correct" : "incorrect",
          score: correct ? 100 : 0,
          reviewStatus: correct ? "mastered" : "pending",
          isAdmin: Boolean(stored.isAdmin),
        });
      }

      let failedMinimum = practicalFailedMinimum;
      for (const score of Object.values(subjectScores)) {
        score.rate = score.possible ? rounded(score.earned / score.possible * 100, 1) : 0;
        score.failedMinimum = score.rate < config.subjectMinimumRate;
        if (score.failedMinimum) failedMinimum = true;
      }
      const unroundedTotal = Math.min(config.totalPoints, objectiveScore + descriptiveScore);
      const decimals = selectedExam === "IPEP" ? 2 : config.resultDecimals;
      objectiveScore = rounded(objectiveScore, decimals);
      descriptiveScore = rounded(descriptiveScore, decimals);
      const totalScore = rounded(unroundedTotal, decimals);
      const submittedAt = new Date(Math.min(Date.parse(claimAt), Date.parse(stored.endsAt))).toISOString();
      const result: ExamResult = {
        examType: selectedExam,
        examForm: session.examForm,
        objectiveScore,
        descriptiveScore,
        totalScore,
        correctCount,
        incorrectCount,
        ...(selectedExam === "IPEP" ? { partialCount } : {}),
        unansweredCount,
        subjectScores,
        practicalEvaluations,
        questionResults,
        breakdowns: {
          topics: buildExamResultBreakdown(questionResults, byId, (question) => question.topic || "미분류"),
          difficulties: buildExamResultBreakdown(questionResults, byId, (question) => question.difficulty || "기록 없음"),
        },
        passed: (selectedExam === "IPEP" ? unroundedTotal + 1e-9 : totalScore) >= config.passingScore && !failedMinimum,
        failedMinimum,
        autoSubmitted,
        submittedAt,
      };
      await studyRepository.completeExamSubmission({
        recordGuestAnalytics,
        attempts: isGuestLearningKey(key) ? [] : attemptRows,
        sessionId: stored.id,
        userKey: key,
        answers: JSON.stringify(answers),
        descriptiveAnswers: JSON.stringify(descriptiveAnswers),
        descriptiveScores: JSON.stringify(descriptiveScores),
        descriptiveSnapshots: JSON.stringify(descriptiveSnapshots),
        flagged: JSON.stringify(state.flagged),
        currentIndex: state.currentIndex,
        submittedAt,
        result: JSON.stringify(result),
      });
      const saved = await sessionForUser(studyRepository, key, stored.id);
      return Response.json({
        session: parseExamSession(saved),
        questions: rows,
      }, { headers: { "Cache-Control": PRIVATE_CACHE_CONTROL } });
    } catch (error) {
      await studyRepository.restoreExamActive(stored.id, now()).catch(() => undefined);
      throw error;
    }
  }

  return { startExam, saveExam, submitExam };
}
