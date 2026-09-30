import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";
import { getRuntimeEnv } from "@backend/infrastructure/database";
import { REQUIRED_OPERATIONAL_OBJECTS } from "./domain/health.domain";

type ShallowHealthRow = {
  reachable: number;
  migration_version: string | null;
  migration_applied_at: string | null;
  release_version: string | null;
  release_schema_version: string | null;
  release_activated_at: string | null;
  present_objects: string;
};

export class HealthRepository extends DatabaseRepository {
  groupExamEnabled() {
    return getRuntimeEnv().SKCT_GROUP_SERVICE_ENABLED === "1";
  }

  async readShallowStatus() {
    const database = this.connection();
    const placeholders = REQUIRED_OPERATIONAL_OBJECTS.map(() => "?").join(",");
    const row = await database.prepare(`
      WITH latest_release AS (
        SELECT version, schema_version, activated_at
        FROM content_releases
        WHERE status = 'active'
        ORDER BY activated_at DESC, created_at DESC
        LIMIT 1
      )
      SELECT 1 AS reachable,
        (SELECT migration_version FROM app_schema_state WHERE id = 1) AS migration_version,
        (SELECT applied_at FROM app_schema_state WHERE id = 1) AS migration_applied_at,
        (SELECT version FROM latest_release) AS release_version,
        (SELECT schema_version FROM latest_release) AS release_schema_version,
        (SELECT activated_at FROM latest_release) AS release_activated_at,
        COALESCE((
          SELECT json_group_array(name)
          FROM sqlite_master
          WHERE name IN (${placeholders})
        ), '[]') AS present_objects
    `).bind(...REQUIRED_OPERATIONAL_OBJECTS).first<ShallowHealthRow>();
    let presentObjectNames: unknown = [];
    try {
      presentObjectNames = JSON.parse(row?.present_objects ?? "[]");
    } catch {
      presentObjectNames = [];
    }
    const presentObjects = new Set(
      Array.isArray(presentObjectNames)
        ? presentObjectNames.filter((name): name is string => typeof name === "string")
        : [],
    );
    return {
      databaseReachable: row?.reachable === 1,
      schema: row?.migration_version
        ? {
            migration_version: row.migration_version,
            applied_at: row.migration_applied_at,
          }
        : null,
      release: row?.release_version && row.release_schema_version
        ? {
            version: row.release_version,
            schema_version: row.release_schema_version,
            activated_at: row.release_activated_at,
          }
        : null,
      requiredObjects: REQUIRED_OPERATIONAL_OBJECTS.map((name) => ({
        name,
        present: presentObjects.has(name),
      })),
    };
  }

  async readGroupExamReadiness() {
    // Group exams prefer the active personal bank. Immutable legacy mirrors
    // remain available for old results and must not make that bank unhealthy.
    const personal = await this.connection().prepare(`
      WITH active_release AS (
        SELECT id, content_sha256, item_count FROM skct_personal_releases
        WHERE status = 'ACTIVE' AND item_count = 300
        ORDER BY created_at DESC, id DESC LIMIT 1
      )
      SELECT
        (SELECT COUNT(*) FROM skct_personal_releases WHERE status='ACTIVE' AND item_count=300) AS active_release_count,
        (SELECT id FROM active_release) AS release_id,
        (SELECT content_sha256 FROM active_release) AS release_sha256,
        (SELECT item_count FROM active_release) AS declared_eligible_count,
        (SELECT COUNT(*) FROM skct_personal_public_items p JOIN active_release r ON r.id=p.release_id) AS public_count,
        (SELECT COUNT(*) FROM skct_personal_secret_items s JOIN active_release r ON r.id=s.release_id) AS secret_count,
        (SELECT COUNT(*) FROM skct_personal_public_items p JOIN skct_personal_secret_items s
          USING(release_id,source_item_id) JOIN active_release r ON r.id=p.release_id) AS selectable_count,
        (SELECT COUNT(*) FROM (
          SELECT p.unit_id FROM skct_personal_public_items p JOIN active_release r ON r.id=p.release_id
          WHERE p.unit_id IN ('U01','U02','U03','U04','U05') GROUP BY p.unit_id HAVING COUNT(*)=60
        )) AS complete_area_count
    `).first<Record<string, unknown>>();
    if (personal?.release_id) {
      const activeReleaseCount=Number(personal.active_release_count), declaredEligibleCount=Number(personal.declared_eligible_count);
      const publicCount=Number(personal.public_count), secretCount=Number(personal.secret_count), selectableCount=Number(personal.selectable_count);
      return {
        ready: activeReleaseCount===1 && declaredEligibleCount===300 && publicCount===300
          && secretCount===300 && selectableCount===300 && Number(personal.complete_area_count)===5,
        activeReleaseCount, releaseId:String(personal.release_id), releaseSha256:String(personal.release_sha256),
        declaredEligibleCount, quarantineCount:0, publicCount, secretCount, selectableCount,
      };
    }
    const row = await this.connection().prepare(`
      WITH active_release AS (
        SELECT id, release_sha256, eligible_count, quarantine_count
        FROM skct_content_releases
        WHERE status = 'active'
        ORDER BY created_at DESC, id DESC LIMIT 1
      )
      SELECT
        (SELECT COUNT(*) FROM skct_content_releases WHERE status = 'active') AS active_release_count,
        (SELECT id FROM active_release) AS release_id,
        (SELECT release_sha256 FROM active_release) AS release_sha256,
        (SELECT eligible_count FROM active_release) AS declared_eligible_count,
        (SELECT quarantine_count FROM active_release) AS quarantine_count,
        (SELECT COUNT(*) FROM skct_question_public p
          JOIN active_release r ON r.id = p.release_id
          WHERE p.eligibility = 'eligible') AS public_count,
        (SELECT COUNT(*) FROM skct_question_secret s
          JOIN active_release r ON r.id = s.release_id) AS secret_count,
        (SELECT COUNT(*) FROM skct_question_public p
          JOIN skct_question_secret s USING (release_id, question_uid)
          JOIN active_release r ON r.id = p.release_id
          WHERE p.eligibility = 'eligible') AS selectable_count
    `).first<Record<string, unknown>>();
    const activeReleaseCount = Number(row?.active_release_count ?? 0);
    const declaredEligibleCount = Number(row?.declared_eligible_count ?? 0);
    const publicCount = Number(row?.public_count ?? 0);
    const secretCount = Number(row?.secret_count ?? 0);
    const selectableCount = Number(row?.selectable_count ?? 0);
    return {
      ready: activeReleaseCount === 1
        && declaredEligibleCount >= 15
        && publicCount === declaredEligibleCount
        && secretCount === declaredEligibleCount
        && selectableCount === declaredEligibleCount,
      activeReleaseCount,
      releaseId: typeof row?.release_id === "string" ? row.release_id : null,
      releaseSha256: typeof row?.release_sha256 === "string" ? row.release_sha256 : null,
      declaredEligibleCount,
      quarantineCount: Number(row?.quarantine_count ?? 0),
      publicCount,
      secretCount,
      selectableCount,
    };
  }
}
