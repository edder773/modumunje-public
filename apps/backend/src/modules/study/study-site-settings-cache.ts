import {
  DEFAULT_EXAM_TYPE,
  isReleasedExamType,
  type ExamType,
} from "./domain/study.domain";
import type { StudyRepository } from "./study.repository";

export type PublicSiteSettings = {
  notice: string;
  maintenanceMode: boolean;
  defaultExamMode: ExamType;
};

export function publicSiteSettingsFromRows(rows: Array<{ key: string; value: string }>) {
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    notice: values.site_notice ?? "",
    maintenanceMode: values.maintenance_mode === "true",
    defaultExamMode: isReleasedExamType(values.default_exam_mode)
      ? values.default_exam_mode
      : DEFAULT_EXAM_TYPE,
  } satisfies PublicSiteSettings;
}

// Control state is deliberately read on every request, including content-cache hits.
export async function readPublicSiteSettings(
  repository: Pick<StudyRepository, "findPublicSiteSettings">,
) {
  return publicSiteSettingsFromRows(await repository.findPublicSiteSettings());
}
