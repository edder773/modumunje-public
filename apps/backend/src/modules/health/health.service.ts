import { withApiErrorBoundary } from "@backend/common/http/api-response";
import { HealthRepository } from "./health.repository";

const PUBLIC_HEALTH_CACHE_MS = 10_000;
const publicHealthRepository = new HealthRepository();

export async function readHealthDiagnostics(repository = new HealthRepository()) {
  const [operational, groupExam] = await Promise.all([
    repository.readShallowStatus(),
    repository.readGroupExamReadiness(),
  ]);
  const groupExamEnabled = repository.groupExamEnabled();
  const missingObjects = operational.requiredObjects
    .filter((object) => !object.present)
    .map((object) => object.name);
  const healthy = operational.databaseReachable
    && operational.schema?.migration_version === __BAEUMZIP_SCHEMA_VERSION__
    && missingObjects.length === 0
    && (!groupExamEnabled || groupExam.ready);

  return {
    status: healthy ? "ok" : "degraded",
    service: "baeumzip",
    build: {
      sha: __BAEUMZIP_BUILD_SHA__,
      builtAt: __BAEUMZIP_BUILT_AT__,
      appVersion: __BAEUMZIP_APP_VERSION__,
    },
    schema: {
      expected: __BAEUMZIP_SCHEMA_VERSION__,
      applied: operational.schema?.migration_version ?? null,
      appliedAt: operational.schema?.applied_at ?? null,
    },
    contentRelease: operational.release
      ? {
          version: operational.release.version,
          schemaVersion: operational.release.schema_version,
          activatedAt: operational.release.activated_at,
        }
      : null,
    database: {
      reachable: operational.databaseReachable,
      missingObjects,
      requiredObjects: operational.requiredObjects,
    },
    groupExam: {
      enabled: groupExamEnabled,
      ...groupExam,
    },
  } as const;
}

let cachedPublicHealth: {
  expiresAt: number;
  value: Promise<Awaited<ReturnType<typeof readHealthDiagnostics>>>;
} | null = null;

async function readCachedPublicHealth() {
  const now = Date.now();
  if (cachedPublicHealth && cachedPublicHealth.expiresAt > now) {
    return cachedPublicHealth.value;
  }
  const value = readHealthDiagnostics(publicHealthRepository);
  cachedPublicHealth = { expiresAt: now + PUBLIC_HEALTH_CACHE_MS, value };
  try {
    return await value;
  } catch (error) {
    if (cachedPublicHealth?.value === value) cachedPublicHealth = null;
    throw error;
  }
}

async function handleGet(repository: HealthRepository, usePublicCache: boolean) {
  const diagnostics = usePublicCache
    ? await readCachedPublicHealth()
    : await readHealthDiagnostics(repository);
  return Response.json({
    status: diagnostics.status,
    service: diagnostics.service,
  }, {
    status: diagnostics.status === "ok" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export async function GET(request: Request, repository = publicHealthRepository) {
  return withApiErrorBoundary(request, () => handleGet(
    repository,
    repository === publicHealthRepository,
  ), {
    code: "HEALTH_CHECK_UNAVAILABLE",
    message: "운영 상태를 확인하지 못했습니다.",
  });
}
