import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";
import { getRuntimeEnv } from "@backend/infrastructure/database";

const ANALYTICS_SETTING_CACHE_TTL_MS = 5_000;

type AnalyticsSettingCache = {
  enabled: boolean;
  expiresAt: number;
};

export type EventInsertStatus = "inserted" | "duplicate" | "disabled" | "invalid-question";

let analyticsSettingCache: AnalyticsSettingCache | undefined;

function rememberAnalyticsSetting(enabled: boolean) {
  analyticsSettingCache = {
    enabled,
    expiresAt: Date.now() + ANALYTICS_SETTING_CACHE_TTL_MS,
  };
  return enabled;
}

export class EventsRepository extends DatabaseRepository {
  rateLimitBinding() {
    return getRuntimeEnv().EVENT_RATE_LIMITER;
  }

  async analyticsEnabled() {
    if (analyticsSettingCache && analyticsSettingCache.expiresAt > Date.now()) {
      return analyticsSettingCache.enabled;
    }
    const setting = await this.connection().prepare(
      "SELECT value FROM site_settings WHERE key = 'analytics_enabled'",
    ).first<{ value: string }>();
    return rememberAnalyticsSetting(setting?.value !== "false");
  }

  async countRecentForSession(sessionIdHash: string, since: string, limit: number) {
    const row = await this.connection().prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT 1
        FROM analytics_events
        WHERE anonymous_session_id = ? AND occurred_at >= ?
        LIMIT ?
      )
    `).bind(sessionIdHash, since, limit).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async insertEvent(
    values: readonly unknown[],
    questionId: number | null,
  ): Promise<EventInsertStatus> {
    const database = this.connection();
    const inserted = await database.prepare(`
      INSERT OR IGNORE INTO analytics_events (
        id, event_type, occurred_at, anonymous_session_id, user_key_hash,
        is_admin, exam_scope, subject, question_id, content_id, answer_result,
        duration_ms, page_path, referrer_host,
        device_category, viewport_bucket, browser_family, metric_name,
        metric_value, api_route, http_status, retry_count, cache_source,
        build_sha, dedupe_key
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE COALESCE((
        SELECT value FROM site_settings WHERE key = 'analytics_enabled' LIMIT 1
      ), 'true') != 'false'
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM questions WHERE id = ?
        ))
    `).bind(...values, questionId, questionId).run();
    if (Number(inserted.meta.changes ?? 0) > 0) return "inserted";

    const statements = [
      database.prepare("SELECT value FROM site_settings WHERE key = 'analytics_enabled' LIMIT 1"),
    ];
    if (questionId) {
      statements.push(database.prepare("SELECT id FROM questions WHERE id = ?").bind(questionId));
    }
    const [settingResult, questionResult] = await database.batch(statements);
    const setting = (settingResult.results ?? [])[0] as { value?: string } | undefined;
    const analyticsEnabled = rememberAnalyticsSetting(setting?.value !== "false");
    if (!analyticsEnabled) return "disabled";
    if (questionId && !(questionResult?.results ?? []).length) return "invalid-question";
    return "duplicate";
  }
}
