import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";

export class GroupExamPresenceRepository extends DatabaseRepository {
  async heartbeat(input: {
    groupId: string;
    userKey: string;
    sessionId: string;
    pageContext: "lobby" | "exam";
    visible: boolean;
    timestamp: string;
    staleBefore: string;
  }) {
    const batch = await this.connection().batch([
      this.connection().prepare(`
        INSERT INTO study_group_presence_sessions (
          group_id, user_key, session_id, page_context, visible, last_seen_at, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM study_group_members m
          WHERE m.group_id = ? AND m.user_key = ? AND m.status = 'active'
        )
        ON CONFLICT(group_id, user_key, session_id) DO UPDATE SET
          page_context = excluded.page_context,
          visible = excluded.visible,
          last_seen_at = excluded.last_seen_at
      `).bind(
        input.groupId, input.userKey, input.sessionId, input.pageContext,
        input.visible ? 1 : 0, input.timestamp, input.timestamp,
        input.groupId, input.userKey,
      ),
      this.connection().prepare(`
        DELETE FROM study_group_presence_sessions
        WHERE last_seen_at < ?
      `).bind(input.staleBefore),
    ]);
    return Number(batch[0]?.meta?.changes ?? 0) > 0;
  }
}
