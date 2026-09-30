import { parseContentCacheRevision } from "@backend/common/content/content-cache-revision";
import { peekPublicContentCache, readPublicContentCache } from "@backend/common/content/public-content-cache";
import { memoizeD1Request } from "@backend/common/observability/d1-metrics";
import { readActiveTheorySitemapRows } from "./public-theory-sitemap.repository";
import { normalizeMarkdownProse } from "@shared/content/content-format.mjs";
import {
  LEARNING_CATALOG, learningCourse, learningField, learningPath,
  parseLearningPath, type LearningRoute,
} from "@shared/study/learning-catalog";
import { isTheoryReadingRoute } from "@shared/study/learning-access";
import { acceptedContentScopes, courseDefinition, examScopeAllows, uniqueStrings } from "./domain/study.domain";
import { theoryDetailDelivery } from "./study-theory-delivery";
import { StudyRepository } from "./study.repository";
import { SwStudyRepository } from "../sw-study/sw-study.repository";

import type { PublicTheoryArticle } from "@shared/study/public-theory";

type PublicTheoryDocument = {
  name: string;
  articles: PublicTheoryArticle[];
  selected: PublicTheoryArticle | null;
  listPath: string;
  homePath: string;
  practicePath: string | null;
};

function canonicalTheoryPath(id: number, examScope: string, fallback: string) {
  const course = LEARNING_CATALOG.flatMap((field) => field.courses)
    .find((candidate) => examScopeAllows(examScope, candidate.examType));
  return course ? learningPath({ page: "theory", examType: course.examType, id }) : fallback;
}

/** Only active editorial content is read here; no user state or question payload. */
export async function readPublicTheoryPage(pathname: string) {
  const route = parseLearningPath(pathname);
  if (!route || !isTheoryReadingRoute(route)) return null;
  return memoizeD1Request(`public-theory-page:${pathname}`, async () => {
    const peeked = peekPublicContentCache<PublicTheoryDocument | null>("public-theory-page", pathname);
    const expectedParts = peeked ? parseContentCacheRevision(peeked.revision) : null;
    const cached = expectedParts ? peeked : null;
    const snapshot = await readUncachedPublicTheoryPage(route, expectedParts, cached?.revision ?? null);
    if (!snapshot) return null;
    if (cached && cached.revision === snapshot.revision) return cached.value;
    return readPublicContentCache({
      namespace: "public-theory-page", key: pathname, revision: snapshot.revision,
      loader: async () => snapshot.page,
    });
  });
}

async function readUncachedPublicTheoryPage(route: LearningRoute,
  expectedParts: [string, string, string] | null, expectedRevision: string | null) {
  let articles: PublicTheoryArticle[];
  let revision: string;
  let name: string;
  let listRoute: LearningRoute;
  let homeRoute: LearningRoute;
  let practiceRoute: LearningRoute | null;
  let selectedId: number | undefined;
  if (route.page === "field") {
    const field = learningField(route.fieldId);
    if (!field) return null;
    const subjects = field.subjectGroups?.flatMap((group) => group.subjects.map((subject) => subject.id)) ?? [];
    if (!subjects.length) return null;
    const repository = new SwStudyRepository();
    selectedId = route.theoryId;
    const snapshot = await repository.findPublicTheorySnapshot(subjects, selectedId, expectedParts);
    revision = snapshot.revision;
    if (expectedRevision === revision) return { revision, page: null };
    const { rows, selected } = snapshot;
    if (selectedId && (!selected || !subjects.includes(selected.subject_id))) return { revision, page: null };
    articles = [...rows].sort((a, b) => subjects.indexOf(a.subject_id) - subjects.indexOf(b.subject_id) || a.sort_order - b.sort_order || a.id - b.id).map((row) => {
      const href = learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId: row.id });
      return {
        id: row.id, title: row.title, category: row.category, topic: row.topic,
        summary: row.summary, updatedAt: row.updated_at, keywords: uniqueStrings(row.keywords), href, canonical: href,
        ...(row.id === selectedId && selected ? {
          content: normalizeMarkdownProse(selected.content ?? ""),
          reviewAnswers: normalizeMarkdownProse(selected.review_answers ?? ""),
        } : {}),
      };
    });
    name = field.name;
    listRoute = { fieldId: field.id, page: "field", section: "theories" };
    homeRoute = { fieldId: field.id, page: "field" };
    practiceRoute = { fieldId: field.id, page: "field", section: "practice" };
  } else {
    selectedId = route.page === "theory" ? route.id : undefined;
    const snapshot = await new StudyRepository().findPublicTheorySnapshot(route.examType, selectedId, expectedParts);
    revision = snapshot.revision;
    if (expectedRevision === revision) return { revision, page: null };
    const { rows, context } = snapshot;
    if (selectedId && (!context || !rows.some((row) => row.id === selectedId))) return { revision, page: null };
    const detail = context ? theoryDetailDelivery(context).row : null;
    const categories: string[] = courseDefinition(route.examType).releasedSubjects.map((subject) => subject.name);
    articles = [...rows].sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) || a.sortOrder - b.sortOrder || a.id - b.id).map((row) => {
      const href = learningPath({ examType: route.examType, page: "theory", id: row.id });
      return {
        id: row.id, title: row.title, category: row.category, topic: row.topic,
        summary: row.summary, updatedAt: row.updatedAt, keywords: uniqueStrings(row.keywords), href, canonical: canonicalTheoryPath(row.id, row.examScope, href),
        ...(detail && row.id === selectedId ? {
          content: normalizeMarkdownProse(detail.content),
          reviewAnswers: normalizeMarkdownProse(detail.reviewAnswers),
        } : {}),
      };
    });
    name = learningCourse(route.examType).name;
    listRoute = { examType: route.examType, page: "theories" };
    homeRoute = { examType: route.examType, page: "home" };
    practiceRoute = learningCourse(route.examType).contentKinds.includes("question")
      ? { examType: route.examType, page: "practice" } : null;
  }
  return { revision, page: {
    name, articles, selected: articles.find((article) => article.id === selectedId) ?? null,
    listPath: learningPath(listRoute), homePath: learningPath(homeRoute),
    practicePath: practiceRoute ? learningPath(practiceRoute) : null,
  } satisfies PublicTheoryDocument };
}

export async function readPublicTheorySitemapEntries() {
  const { courseRows, swRows } = await readActiveTheorySitemapRows();
  const entries = new Map<string, { path: string; updatedAt?: string }>();
  for (const field of LEARNING_CATALOG) {
    if (field.courses.length) {
      for (const course of field.courses) {
        const scopes = acceptedContentScopes(course.examType);
        for (const row of courseRows) {
          if (!scopes.includes(row.examScope as (typeof scopes)[number])) continue;
          const fallback = learningPath({ examType: course.examType, page: "theory", id: row.id });
          const path = canonicalTheoryPath(row.id, row.examScope, fallback);
          entries.set(path, { path, updatedAt: row.updatedAt });
        }
      }
    } else {
      const subjects = new Set(field.subjectGroups?.flatMap((group) => group.subjects.map((subject) => subject.id)) ?? []);
      for (const row of swRows) {
        if (!subjects.has(row.subjectId)) continue;
        const path = learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId: row.id });
        entries.set(path, { path, updatedAt: row.updatedAt });
      }
    }
  }
  return [...entries.values()];
}

export async function readPublicTheorySitemapPaths() {
  return (await readPublicTheorySitemapEntries()).map(entry => entry.path);
}
