import crypto from "node:crypto";
import {
  QUESTION_COLUMNS,
  THEORY_COLUMNS,
  canonicalRowsSha256,
  stableJson,
} from "./content-release.mjs";
import {
  BAE_COURSE,
  inspectBaeContentBundle,
  normalizedBaeImportDocument,
} from "./bae-content-intake.mjs";

export const BAE_RELEASE_CANDIDATE_SCHEMA_VERSION = "bae-release-candidate-v1";
export const DEFAULT_MAXIMUM_MIGRATION_BYTES = 224 * 1024;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return `CAST(X'${Buffer.from(String(value), "utf8").toString("hex")}' AS TEXT)`;
}

function normalizedRows(document) {
  return {
    questions: document.questions
      .map((row) => ({ ...row, variant_group_id: row.variant_group_id ?? null }))
      .sort((left, right) => left.id - right.id),
    theories: document.theories.slice().sort((left, right) => left.id - right.id),
  };
}

function upsertStatement(table, columns, row) {
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `  \`${column}\` = excluded.\`${column}\``)
    .join(",\n");
  return `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(", ")})
VALUES (${columns.map((column) => sqlValue(row[column])).join(", ")})
ON CONFLICT (\`id\`) DO UPDATE SET
${updates};`;
}

function schemaStateStatement(table, ids, migrationVersion) {
  return `INSERT INTO \`app_schema_state\` (\`id\`, \`migration_version\`, \`applied_at\`)
SELECT 1, '${migrationVersion}', CURRENT_TIMESTAMP
WHERE ${ids.length} = (
  SELECT COUNT(*) FROM \`${table}\`
  WHERE \`id\` IN (${ids.join(", ")}) AND \`exam_scope\` = 'BAE' AND \`active\` = 1
)
ON CONFLICT (\`id\`) DO UPDATE SET
  \`migration_version\` = excluded.\`migration_version\`,
  \`applied_at\` = excluded.\`applied_at\`;
--> statement-breakpoint`;
}

function migrationSource({
  contentVersion,
  index,
  kind,
  migrationVersion,
  rows,
  sourceSha256,
  table,
  columns,
}) {
  const statements = rows.map((row) => upsertStatement(table, columns, row));
  const header = `-- Generated BAE ${kind} release candidate ${index}.
-- Content version: ${contentVersion}
-- Source SHA-256: ${sourceSha256}
-- Review before copying into apps/backend/drizzle; this does not release BAE.\n`;
  const footer = [
    schemaStateStatement(table, rows.map((row) => row.id), migrationVersion),
  ].join("\n");
  return `${header}${statements.join("\n--> statement-breakpoint\n\n")}\n--> statement-breakpoint\n\n${footer}\n`;
}

function finalizationSource({
  contentVersion,
  migrationVersion,
  preparedAt,
  questions,
  sourceSha256,
  theories,
}) {
  const questionIds = questions.map((row) => row.id);
  const theoryIds = theories.map((row) => row.id);
  const missingQuestionPredicate = questionIds.length > 0
    ? `AND \`id\` NOT IN (${questionIds.join(", ")})`
    : "";
  const missingTheoryPredicate = theoryIds.length > 0
    ? `AND \`id\` NOT IN (${theoryIds.join(", ")})`
    : "";
  return `-- Finalize the exact active BAE content set for the configured staged release.
-- Content version: ${contentVersion}
-- Source SHA-256: ${sourceSha256}
UPDATE \`questions\`
SET \`active\` = 0, \`updated_at\` = ${sqlValue(preparedAt)}
WHERE \`exam_scope\` = 'BAE' ${missingQuestionPredicate};
--> statement-breakpoint

UPDATE \`theories\`
SET \`active\` = 0, \`updated_at\` = ${sqlValue(preparedAt)}
WHERE \`exam_scope\` = 'BAE' ${missingTheoryPredicate};
--> statement-breakpoint

INSERT INTO \`app_schema_state\` (\`id\`, \`migration_version\`, \`applied_at\`)
SELECT 1, '${migrationVersion}', CURRENT_TIMESTAMP
WHERE ${questionIds.length} = (
  SELECT COUNT(*) FROM \`questions\` WHERE \`exam_scope\` = 'BAE' AND \`active\` = 1
)
  AND ${theoryIds.length} = (
    SELECT COUNT(*) FROM \`theories\` WHERE \`exam_scope\` = 'BAE' AND \`active\` = 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM \`questions\` candidate
    LEFT JOIN \`theories\` theory ON theory.\`id\` = candidate.\`theory_id\`
    WHERE candidate.\`exam_scope\` = 'BAE' AND candidate.\`active\` = 1
      AND (theory.\`id\` IS NULL OR theory.\`active\` != 1 OR theory.\`exam_scope\` != 'BAE')
  )
ON CONFLICT (\`id\`) DO UPDATE SET
  \`migration_version\` = excluded.\`migration_version\`,
  \`applied_at\` = excluded.\`applied_at\`;
--> statement-breakpoint

PRAGMA optimize;
`;
}

function chunkRows({
  contentVersion,
  kind,
  maximumBytes,
  rows,
  sourceSha256,
  table,
  columns,
}) {
  const chunks = [];
  let current = [];
  for (const row of rows) {
    const proposed = [...current, row];
    const preview = migrationSource({
      columns,
      contentVersion,
      index: chunks.length + 1,
      kind,
      migrationVersion: "9999",
      rows: proposed,
      sourceSha256,
      table,
    });
    if (Buffer.byteLength(preview) <= maximumBytes) {
      current = proposed;
      continue;
    }
    if (current.length === 0) {
      throw new Error(`${kind} ${row.id} 한 행이 migration 크기 제한을 초과합니다.`);
    }
    chunks.push(current);
    current = [row];
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function checklist(manifest) {
  return `# BAE canonical 반영 후보 검토

이 폴더는 자동 배포물이나 공개 승인이 아닙니다. 검증된 입력을 재현 가능한 canonical 반영 후보로 묶은 것입니다.

1. \`source.json\`의 출처·권리 검토 기록과 \`normalizedSha256\`을 확인하고, 원본은 \`sourceSha256\`과 대조합니다.
2. 현재 저장소의 다음 migration 번호가 \`${manifest.firstMigration}\`인지 다시 확인합니다.
3. \`migrations/\` 파일을 번호순으로 검토한 뒤에만 \`apps/backend/drizzle\`로 복사합니다.
4. \`npm run verify:migrations\`, \`npm run generate:course-releases\`, 전체 품질 게이트를 실행합니다.
5. 과정 계약의 공개 과목과 콘텐츠 종류가 manifest의 \`releasedSubjectIds\`, \`contentKinds\`와 일치하는지 확인합니다.

- 콘텐츠 버전: ${manifest.contentVersion}
- 이론: ${manifest.theoryCount}개
- 문항: ${manifest.questionCount}개
- migration: ${manifest.migrations.length}개 (${manifest.firstMigration}-${manifest.latestMigration})
`;
}

export function buildBaeReleaseCandidate(source, options = {}) {
  const firstMigration = Number(options.firstMigration);
  const maximumBytes = Number(
    options.maximumMigrationBytes ?? DEFAULT_MAXIMUM_MIGRATION_BYTES,
  );
  if (!Number.isInteger(firstMigration) || firstMigration < 1 || firstMigration > 9999) {
    throw new Error("firstMigration은 1-9999 범위의 정수여야 합니다.");
  }
  if (!Number.isInteger(maximumBytes) || maximumBytes < 16 * 1024) {
    throw new Error("maximumMigrationBytes는 16384 이상의 정수여야 합니다.");
  }

  const inspection = inspectBaeContentBundle(source);
  if (!inspection.readyForRelease) {
    const reasons = [...inspection.errors, ...inspection.blockers];
    throw new Error(`BAE 콘텐츠가 공개 후보 조건을 충족하지 않습니다:\n- ${reasons.join("\n- ")}`);
  }
  const document = normalizedBaeImportDocument(source, inspection);
  const rows = normalizedRows(document);
  const sourceText = stableJson(source);
  const normalizedText = stableJson({ ...document, ...rows });
  const sourceDigest = sha256(sourceText);
  const groups = [
    {
      columns: THEORY_COLUMNS,
      kind: "theories",
      rows: rows.theories,
      table: "theories",
    },
    {
      columns: QUESTION_COLUMNS,
      kind: "questions",
      rows: rows.questions,
      table: "questions",
    },
  ];
  const pending = groups.flatMap((group) => chunkRows({
    ...group,
    contentVersion: document.contentVersion,
    maximumBytes,
    sourceSha256: sourceDigest,
  }).map((chunk, index) => ({ ...group, index: index + 1, rows: chunk })));
  if (firstMigration + pending.length > 9999) {
    throw new Error("생성할 migration 번호가 9999를 초과합니다.");
  }

  const migrations = pending.map((migration, offset) => {
    const migrationNumber = firstMigration + offset;
    const migrationVersion = String(migrationNumber).padStart(4, "0");
    const name = `${migrationVersion}_import_bae_${migration.kind}_${String(migration.index).padStart(2, "0")}.sql`;
    const content = migrationSource({
      ...migration,
      contentVersion: document.contentVersion,
      migrationVersion,
      sourceSha256: sourceDigest,
    });
    const bytes = Buffer.byteLength(content);
    if (bytes > maximumBytes) throw new Error(`${name}이 migration 크기 제한을 초과합니다.`);
    return {
      bytes,
      content,
      firstId: migration.rows.at(0).id,
      lastId: migration.rows.at(-1).id,
      name,
      rows: migration.rows.length,
      sha256: sha256(content),
      table: migration.table,
      version: migrationVersion,
    };
  });
  const finalMigrationNumber = firstMigration + migrations.length;
  const finalMigrationVersion = String(finalMigrationNumber).padStart(4, "0");
  const finalContent = finalizationSource({
    contentVersion: document.contentVersion,
    migrationVersion: finalMigrationVersion,
    preparedAt: document.preparedAt,
    questions: rows.questions,
    sourceSha256: sourceDigest,
    theories: rows.theories,
  });
  const finalBytes = Buffer.byteLength(finalContent);
  if (finalBytes > maximumBytes) {
    throw new Error("BAE 최종화 migration이 크기 제한을 초과합니다.");
  }
  migrations.push({
    bytes: finalBytes,
    content: finalContent,
    firstId: null,
    lastId: null,
    name: `${finalMigrationVersion}_finalize_bae_content.sql`,
    rows: rows.questions.length + rows.theories.length,
    sha256: sha256(finalContent),
    table: "BAE",
    version: finalMigrationVersion,
  });
  const manifest = {
    candidateSchemaVersion: BAE_RELEASE_CANDIDATE_SCHEMA_VERSION,
    contentVersion: document.contentVersion,
    firstMigration: migrations.at(0).version,
    latestMigration: migrations.at(-1).version,
    licenseReview: document.licenseReview,
    migrations: migrations.map(({
      bytes,
      firstId,
      lastId,
      name,
      rows: rowCount,
      sha256: migrationSha256,
      table,
      version,
    }) => ({
      bytes,
      firstId,
      lastId,
      name,
      rows: rowCount,
      sha256: migrationSha256,
      table,
      version,
    })),
    normalizedSha256: sha256(normalizedText),
    preparedAt: document.preparedAt,
    questionCount: rows.questions.length,
    questionSha256: canonicalRowsSha256(rows.questions),
    contentKinds: [...(BAE_COURSE.contentKinds ?? ["theory", "question", "mock-exam"])],
    releaseStage: BAE_COURSE.releaseStage,
    releasedSubjectIds: (BAE_COURSE.releasedSubjects ?? BAE_COURSE.subjects)
      .map((subject) => subject.id),
    questionSubjectIds: (BAE_COURSE.questionSubjects ?? []).map((subject) => subject.id),
    replacementPolicy: "deactivate-missing-bae-rows",
    sourceDocuments: document.sourceDocuments,
    sourceReview: document.sourceReview,
    sourceSha256: sourceDigest,
    subjectCoverage: inspection.subjectCoverage,
    theoryCount: rows.theories.length,
    theorySha256: canonicalRowsSha256(rows.theories),
  };
  return {
    checklist: checklist(manifest),
    manifest,
    manifestText: stableJson(manifest),
    migrations,
    normalizedText,
  };
}
