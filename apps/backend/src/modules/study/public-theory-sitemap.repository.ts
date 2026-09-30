import { getD1 } from "@backend/infrastructure/database";

type CourseSitemapRow = { id: number; examScope: string; updatedAt?: string };
type SwSitemapRow = { id: number; subjectId: string; updatedAt?: string };

/** Active editorial identifiers and dates only; no article body or learner state. */
export async function readActiveTheorySitemapRows() {
  const db = getD1();
  const [courses, sw] = await db.batch([
    db.prepare(`
      SELECT id, exam_scope AS examScope, updated_at AS updatedAt
      FROM theories WHERE active = 1
      ORDER BY category, sort_order, id
    `),
    db.prepare(`
      SELECT id, subject_id AS subjectId, updated_at AS updatedAt
      FROM sw_theories WHERE active = 1
      ORDER BY sort_order, id
    `),
  ]);
  return {
    courseRows: (courses.results ?? []) as CourseSitemapRow[],
    swRows: (sw.results ?? []) as SwSitemapRow[],
  };
}
