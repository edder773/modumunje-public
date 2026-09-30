import { releasedLocalPracticeCourses, localPracticeWorkbooks, localPracticePath } from "@shared/study/local-practice";
import { PREPARING_COURSES, PREPARING_FIELDS, preparingCoursePath } from "@shared/study/preparing-courses";
import {
  LEARNING_CATALOG,
  learningFieldEngine,
  learningPath,
} from "@shared/study/learning-catalog";

import type { CatalogFieldCard } from "./catalog-search";
export { searchCatalogFields, type CatalogFieldCard } from "./catalog-search";

export const CATALOG_FIELD_CARDS: CatalogFieldCard[] = [...LEARNING_CATALOG.map((field) => {
  const engine = learningFieldEngine(field);
  const practiceCourses = releasedLocalPracticeCourses(field.id);
  const courseBased = engine.catalog.mode === "courses";
  return {
    id: field.id,
    name: field.name,
    shortLabel: field.shortLabel,
    cardTitle: field.cardTitle,
    summary: field.summary,
    href: learningPath({ fieldId: field.id, page: "field" }),
    offerings: courseBased
      ? [...field.courses.map((course) => `${course.name} 과정`), ...practiceCourses.map(course => `${course.name} · ${localPracticeWorkbooks(course).map(item => item.title).join("·")}`)]
      : [...engine.catalog.offerings],
    actionLabel: courseBased
      ? `${[...field.courses, ...practiceCourses].map((course) => course.name).join("·")} 과정 선택 →`
      : `${field.shortLabel} ${engine.catalog.actionLabelSuffix}`,
    links: courseBased
      ? [
          ...field.courses.map(course => ({ name: course.name, href: learningPath({ examType: course.examType, page: "home" }) })),
          ...practiceCourses.map(course => ({ name: course.name, href: localPracticePath(course) })),
          ...PREPARING_COURSES.filter(course => course.fieldId === field.id).map(course => ({ name: course.name, href: preparingCoursePath(course), preparing: true })),
        ].map(course => ({ ...course, label: course.name.startsWith(`${field.cardTitle} `) ? course.name.slice(field.cardTitle.length + 1) : course.name }))
      : [{ name: field.cardTitle, label: "학습 범위 선택", href: learningPath({ fieldId: field.id, page: "field" }) }],
  };
}), {
  id: "skct-personal",
  name: "SKCT 개인학습",
  shortLabel: "SKCT",
  cardTitle: "SKCT 개인학습",
  summary: "영역별 문제 풀이와 모의고사, 학습 기록을 이용합니다.",
  href: "/learn/skct-personal",
  offerings: ["언어이해", "자료해석", "창의수리", "언어추리", "수열추리"],
  actionLabel: "학습하기 →",
  links: [{ name: "SKCT 개인학습", label: "학습 홈", href: "/learn/skct-personal" }],
}, ...PREPARING_FIELDS.map(field => ({
  ...field,
  href: `/learn/${field.id}`,
  offerings: PREPARING_COURSES.filter(course => course.fieldId === field.id).map(course => course.name),
  actionLabel: "준비 중인 과정 보기",
  preparing: true,
  links: PREPARING_COURSES.filter(course => course.fieldId === field.id).map(course => ({
    name: course.name,
    label: course.name.replace(`${field.cardTitle} `, ""),
    href: preparingCoursePath(course),
    preparing: true,
  })),
}))];
