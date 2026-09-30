import type { MetadataRoute } from "next";
import { koreaDateKey, parseUtcDate } from "@shared/date/korea-date.mjs";
import { LEARNING_CATALOG, learningPath } from "@shared/study/learning-catalog";
import { acceptedContentScopes } from "@shared/study/course-registry";
import { releasedLocalPracticeCourses, localPracticePath, localPracticeWorkbooks } from "@shared/study/local-practice";
import { PUBLIC_GUIDE_LINKS } from "@frontend/features/public-content/public-guide-links";
import { cachedSitemapTheoryDates } from "@backend/modules/study/public-sitemap-dates";
import { GUIDE_SOURCE_DATES, SITEMAP_SOURCE_DATES } from "@frontend/features/public-content/sitemap-source-dates";

export const dynamic = "force-dynamic";

function databaseDate(value: string | null | undefined) {
  if (!value) return null;
  const date=parseUtcDate(value);
  return Number.isFinite(date.getTime()) ? koreaDateKey(date) : null;
}
function latestDate(...dates: Array<string | null | undefined>) {
  return dates.filter((date): date is string => Boolean(date)).sort().at(-1);
}
function releaseDate(version: string) {
  const value=/^\d{4}-\d{2}-\d{2}(?=-|$)/u.exec(version)?.[0];
  return value && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()) ? value : null;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = "https://modumunje.com";
  const theoryDates=await cachedSitemapTheoryDates();
  return [
    ...LEARNING_CATALOG.flatMap((field) => {
      if (!field.courses.length) {
        const updated=databaseDate(theoryDates.swUpdatedAt);
        return [
          { path: learningPath({ fieldId: field.id, page: "field" }),
            date: latestDate(SITEMAP_SOURCE_DATES.swFieldHome,updated) },
          { path: learningPath({ fieldId: field.id, page: "field", section: "theories" }),
            date: latestDate(SITEMAP_SOURCE_DATES.swTheoryDirectory,updated) },
        ];
      }
      return field.courses.flatMap((course) => {
        const updated=latestDate(...acceptedContentScopes(course.examType)
          .map(scope => databaseDate(theoryDates.byScope.get(scope))));
        return [
          { path: learningPath({ examType: course.examType, page: "home" }),
            date: latestDate(SITEMAP_SOURCE_DATES.courseHome,updated) },
          { path: learningPath({ examType: course.examType, page: "theories" }),
            date: latestDate(SITEMAP_SOURCE_DATES.theoryDirectory,updated) },
        ];
      });
    }).map(({path,date}) => ({ url: `${origin}${path}`, lastModified: date,
      changeFrequency: "weekly" as const, priority: .8 })),
    ...releasedLocalPracticeCourses().map(course => ({
      url: `${origin}${localPracticePath(course)}`,
      lastModified: latestDate(SITEMAP_SOURCE_DATES.localPracticeHome,
        ...localPracticeWorkbooks(course).map(workbook => releaseDate(workbook.release.version))),
      changeFrequency: "weekly" as const, priority: .8,
    })),
    { url: `${origin}/`, lastModified: SITEMAP_SOURCE_DATES.home, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/guides`, lastModified: SITEMAP_SOURCE_DATES.guidesIndex,
      changeFrequency: "monthly", priority: .9 },
    ...PUBLIC_GUIDE_LINKS.map(({ slug }) => ({
      url: `${origin}/guides/${slug}`, lastModified: GUIDE_SOURCE_DATES[slug],
      changeFrequency: "monthly" as const, priority: .8,
    })),
    { url: `${origin}/about`, lastModified: SITEMAP_SOURCE_DATES.about,
      changeFrequency: "monthly", priority: .6 },
    { url: `${origin}/privacy`, lastModified: SITEMAP_SOURCE_DATES.privacy,
      changeFrequency: "yearly", priority: .3 },
  ];
}
