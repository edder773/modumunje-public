export const EXPECTED_SCHEMA_VERSION = "0564";
export const SCHEMA_BASELINE_VERSION = "0554";

// Stage 9 freezes the mixed schema/content era. Migrations after this cutoff
// may evolve database structure, but learning-content rows move only through
// the versioned content-release pipeline.
export const CONTENT_MIGRATION_CUTOFF = "0553";
export const CONTENT_RELEASE_TABLES = Object.freeze([
  "content_releases",
  "questions",
  "sw_questions",
  "sw_theories",
  "theories",
]);

export const SCHEMA_BASELINE_LOCK = Object.freeze({
  through: SCHEMA_BASELINE_VERSION,
  count: 1,
  sha256: "a51675ee0aad61c6f2ba55d3753953e385ea39b0a5bbe0e4cdaa1350763f8c63",
});
