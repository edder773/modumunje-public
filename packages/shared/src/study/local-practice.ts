import { LOCAL_PRACTICE_COURSES } from "./course-contract.mjs";
import { LOCAL_PRACTICE_RELEASES } from "./local-practice-release";
import { LOCAL_PRACTICE_TYPE2_RELEASE } from "./local-practice-type2-release";
import { isType2QuestionId } from "./local-practice-type2";
import { LOCAL_PRACTICE_TYPE3_RELEASE } from "./local-practice-type3-release";
import { isType3QuestionId } from "./local-practice-type3";
import { learningEngine } from "./learning-engine";

export const releasedLocalPracticeCourses = (fieldId?: string) => LOCAL_PRACTICE_COURSES.filter(course =>
  (!fieldId || course.fieldId === fieldId) && learningEngine(course.engineId).capabilities.includes(course.capability) && LOCAL_PRACTICE_RELEASES.some(release => release.courseId === course.releaseKey
    && release.stage === "released" && release.capability === course.capability && release.questionCount > 0));
export type LocalPracticeCourse = (typeof LOCAL_PRACTICE_COURSES)[number];
export type LocalPracticeRelease = { readonly courseId: string; readonly capability: string; readonly stage: string; readonly version: string; readonly prefix: string;
  readonly indexSha256: string; readonly sourceSha256: string; readonly questionCount: number; readonly subquestionCount?: number; readonly moduleCount: number; readonly datasetCount: number; readonly checkpointCount: number };
export function localPracticePath(course: LocalPracticeCourse, section: "home" | "workbook" = "home") {
  return `/learn/${course.fieldId}/${course.courseId}/${section === "home" ? "home" : course.section}`;
}
export function parseLocalPracticePath(path: string) {
  const course = releasedLocalPracticeCourses().find(course => path === localPracticePath(course) || localPracticeWorkbooks(course).some(item => item.href === path));
  if (!course) return null;
  const workbook = localPracticeWorkbooks(course).find(item => item.href === path) ?? localPracticeWorkbooks(course)[0];
  return { course, section: path === localPracticePath(course) ? "home" as const : "workbook" as const,
    workbook, release: workbook.release };
}
export function localPracticeWorkbooks(course: LocalPracticeCourse) {
  const workbooks: { id: string; title: string; description: string; href: string; release: LocalPracticeRelease }[] = [
    { id: course.section, title: course.sectionTitle, description: "데이터 처리 · 전처리 · 기술통계", href: localPracticePath(course, "workbook"), release: LOCAL_PRACTICE_RELEASES.find(release => release.courseId === course.releaseKey)! },
  ];
  if (LOCAL_PRACTICE_TYPE2_RELEASE.courseId === course.courseId && LOCAL_PRACTICE_TYPE2_RELEASE.stage === "released") {
    workbooks.push({ id: "type-2", title: "작업형 제2유형", description: "분류 · 회귀 · 예측 결과 제출", href: `/learn/${course.fieldId}/${course.courseId}/type-2`, release: LOCAL_PRACTICE_TYPE2_RELEASE });
  }
  if (LOCAL_PRACTICE_TYPE3_RELEASE.courseId === course.courseId && LOCAL_PRACTICE_TYPE3_RELEASE.stage === "released") {
    workbooks.push({ id: "type-3", title: "작업형 제3유형", description: "가설검정 · 회귀분석", href: `/learn/${course.fieldId}/${course.courseId}/type-3`, release: LOCAL_PRACTICE_TYPE3_RELEASE });
  }
  return workbooks;
}

export const PRACTICE_PAGE_SIZE = 10;
export const PRACTICE_DIFFICULTIES = ["기초", "기본", "응용", "실전"] as const;
export type PracticeFilters = { q: string; module: string; difficulty: string; page: number };
export type PracticeIndexRow = { id: string; number: number; module: number; difficulty: string; title: string; datasets: string[] };
export type PracticeDatasetGroup = { key: string; datasets: string[]; inputs: { variable: string; file: string }[]; count: number };
export type PracticePageSection = { group: PracticeDatasetGroup; rows: PracticeIndexRow[]; start: number; total: number };
export type PracticeIndex = { version: string; count: number; modules: { number: number; title: string; count: number }[];
  datasets: { file: string; sha256: string }[]; datasetGroups: PracticeDatasetGroup[]; files: Record<string, string>; questions: PracticeIndexRow[] };
export type PracticeQuestion = PracticeIndexRow & { module_title: string; statement: string; answer_type: string;
  answer_format: string; practice_file: string; scope: string; authorship: string; source_basis: string[] };
export type PracticeAnswer = { version: string; id: string; answer: string; solution_core: string; solution_inputs: { variable: string; file: string }[];
  learning_point: string; solution_file: string; execution: { stdout: string; verified: boolean; environment: Record<string, string>;
    checkpoints: { label: string; before_core_statement: string; code: string; stdout: string; description: string; rows_total: number | null; rows_shown: number | null }[] } };
export type PracticeGuide = { version: string; sections: { title: string; paragraphs: string[]; examples?: { title: string; code: string; language?: string }[] }[] };

export function parsePracticeFilters(query: string): PracticeFilters {
  const p = new URLSearchParams(query);
  const moduleFilter = p.get("module") ?? "", difficulty = p.get("difficulty") ?? "";
  const raw = p.get("page") ?? "1";
  const page = /^\d+$/u.test(raw) ? Number(raw) : 1;
  return { q: (p.get("q") ?? "").slice(0, 200).trim(),
    module: /^(?:[1-9]|1[0-9]|20)$/u.test(moduleFilter) ? moduleFilter : "",
    difficulty: PRACTICE_DIFFICULTIES.some(level => level === difficulty) ? difficulty : "",
    page: Number.isSafeInteger(page) ? Math.max(1, page) : 1 };
}
export function practiceFilterQuery(filters: PracticeFilters) {
  const p = new URLSearchParams();
  for (const key of ["q", "module", "difficulty"] as const) if (filters[key]) p.set(key, filters[key]);
  if (filters.page > 1) p.set("page", String(filters.page));
  return p.toString();
}
export function practiceDatasetKey(files: string[]) { return [...files].sort().join("|"); }
export function practicePage(index: PracticeIndex, filters: PracticeFilters) {
  const normalize = (text: string) => text.normalize("NFKC").toLowerCase().trim();
  const search = normalize(filters.q), terms = search.split(/\s+/u).filter(Boolean);
  const modules = new Map(index.modules.map(item => [item.number, item.title]));
  const matching = index.questions.filter(question => {
    if (filters.module && question.module !== Number(filters.module)) return false;
    if (filters.difficulty && question.difficulty !== filters.difficulty) return false;
    if (/^\d+$/u.test(search)) return question.number === Number(search);
    const text = normalize(`${question.id} ${question.title} ${modules.get(question.module) ?? ""} ${question.datasets.join(" ")}`);
    return terms.every(term => text.includes(term));
  });
  const groups = index.datasetGroups.map(group => ({ group, rows: matching.filter(question => practiceDatasetKey(question.datasets) === group.key) }));
  const rows = groups.flatMap(group => group.rows);
  const pages = Math.max(1, Math.ceil(rows.length / PRACTICE_PAGE_SIZE));
  const page = Math.max(1, Math.min(pages, Number.isSafeInteger(filters.page) ? filters.page : 1));
  const pageRows = rows.slice((page - 1) * PRACTICE_PAGE_SIZE, page * PRACTICE_PAGE_SIZE);
  const ids = new Set(pageRows.map(question => question.id));
  const sections: PracticePageSection[] = groups.flatMap(({ group, rows: groupRows }) => {
    const visible = groupRows.filter(question => ids.has(question.id));
    return visible.length ? [{ group, rows: visible, start: groupRows.findIndex(question => question.id === visible[0].id) + 1, total: groupRows.length }] : [];
  });
  return { total: rows.length, pages, page, rows: pageRows, sections };
}
export async function loadPracticeAsset<T>(release: LocalPracticeRelease, file: string, digest: string, signal?: AbortSignal): Promise<T> {
  const type2File = /^(?:questions|references)\/(T2-\d{3})\.json$/u.exec(file);
  const type3File = /^(?:questions|references)\/(T3-\d{3})\.json$/u.exec(file);
  if (!(/^(?:index\.json|guide\.json|questions\/(?:[1-9]|1[0-9]|20)\.json|answers\/T1-\d{3}\.json)$/u.test(file) || (type2File && isType2QuestionId(type2File[1])) || (type3File && isType3QuestionId(type3File[1])))
    || !/^[0-9a-f]{64}$/u.test(digest)) throw new Error("자료 경로를 확인할 수 없습니다.");
  const response = await fetch(`${release.prefix}/${file}`, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error("자료를 불러오지 못했습니다. 다시 시도해 주세요.");
  const bytes = await response.arrayBuffer();
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  if (actual !== digest) throw new Error("자료 버전이 일치하지 않습니다. 페이지를 새로고침해 주세요.");
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (value.version !== release.version) throw new Error("자료 버전을 확인해 주세요.");
  return value as T;
}
