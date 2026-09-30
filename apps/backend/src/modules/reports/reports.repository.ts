import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";

export class ReportsRepository extends DatabaseRepository {
  async findRecentForUser(userKey: string) {
    const rows = await this.connection().prepare(`
      SELECT id, category, title, page_path, question_id, status, created_at, updated_at
      FROM user_reports
      WHERE user_key = ?
      ORDER BY created_at DESC
      LIMIT 30
    `).bind(userKey).all();
    return rows.results ?? [];
  }

  async questionExists(questionId: number) {
    return Boolean(await this.connection().prepare(
      "SELECT id FROM questions WHERE id = ?",
    ).bind(questionId).first());
  }

  async countRecentForUser(userKey: string, since: string) {
    const row = await this.connection().prepare(`
      SELECT COUNT(*) AS count
      FROM user_reports
      WHERE user_key = ? AND created_at >= ?
    `).bind(userKey, since).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async create(input: {
    id: string;
    userKey: string;
    category: string;
    title: string;
    description: string;
    questionId: number | null;
    createdAt: string;
  }) {
    await this.connection().prepare(`
      INSERT INTO user_reports (
        id, user_key, category, title, description, page_path,
        question_id, status, admin_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', ?, 'new', '', ?, ?)
    `).bind(
      input.id,
      input.userKey,
      input.category,
      input.title,
      input.description,
      input.questionId,
      input.createdAt,
      input.createdAt,
    ).run();
  }
}
