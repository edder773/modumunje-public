import { type D1Row, inferredQuestionPracticeScope, stripTheoryDifficultyMetadata } from "./admin-use-case-runtime";
import { BACKUP_SCHEMA_VERSION } from "@shared/admin/backup-contract.mjs";

/**
 * A backup carrying any release rows, regardless of their status, preserves
 * its exact content bytes alongside that metadata. Full snapshots
 * preserve theory bytes; current-schema full snapshots preserve question bytes
 * too. Older full snapshots and loose imports keep their prior compatibility
 * cleanup where no release rows bind the question content.
 */
export function restoredContentRows(
  table: string,
  rows: D1Row[],
  hasReleaseSnapshot: boolean,
  backupType: string,
  schemaVersion: string,
): D1Row[] {
  if (table === "theories" && (backupType === "full" || hasReleaseSnapshot)) return rows;
  if (table === "questions" && (hasReleaseSnapshot || (backupType === "full" && schemaVersion === BACKUP_SCHEMA_VERSION))) return rows;
  if (table === "theories") return rows.map((row) => ({
    ...row,
    difficulty: "",
    content: stripTheoryDifficultyMetadata(row.content),
  }));
  if (table === "questions") return rows.map((row) => ({
    ...row,
    practice_scope: inferredQuestionPracticeScope(row),
  }));
  return rows;
}
