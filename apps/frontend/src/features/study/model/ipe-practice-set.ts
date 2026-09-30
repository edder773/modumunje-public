import { IPE_S3_PRACTICE_SETS } from "@shared/study/ipe-s3-practice-sets.mjs";
import { IPE_S4_PRACTICE_SETS } from "@shared/study/ipe-s4-practice-sets.mjs";
import { IPE_S5_PRACTICE_SETS } from "@shared/study/ipe-s5-practice-sets.mjs";
import type { Question } from "../components/study-screen-shared";

export async function loadIpePracticeSet(
  formId: string,
  examType: string,
  loadQuestions: (ids: string) => Promise<Question[]>,
): Promise<Question[]> {
  const sets = [
    { category: "데이터베이스 구축", forms: IPE_S3_PRACTICE_SETS },
    { category: "프로그래밍 언어 활용", forms: IPE_S4_PRACTICE_SETS },
    { category: "정보시스템 구축 관리", forms: IPE_S5_PRACTICE_SETS },
  ];
  const subject = examType === "IPEW" ? sets.find((set) => set.forms.some((form) => form.id === formId)) : undefined;
  const form = subject?.forms.find((item) => item.id === formId);
  if (!form || !subject) throw new Error("Unknown practice set");
  const byId = new Map((await loadQuestions(form.questionIds.join(","))).map((question) => [question.id, question]));
  const ordered = form.questionIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
  if (ordered.length !== 20 || ordered.some((question) => question.examScope !== "IPEW" || question.category !== subject.category)) {
    throw new Error("Incomplete practice set");
  }
  return ordered;
}
