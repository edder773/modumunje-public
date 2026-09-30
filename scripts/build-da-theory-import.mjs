import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeContentImport } from "../packages/shared/src/admin/admin-import.mjs";
import { splitTheoryReview } from "../packages/shared/src/content/theory-review.mjs";
import {
  REGISTERED_EXAM_TYPES,
  REGISTERED_SUBJECTS,
} from "../packages/shared/src/study/course-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_HEADERS = Object.freeze([
  "id", "title", "category", "topic", "examScope", "summary", "content",
  "reviewAnswers", "keywords", "sortOrder", "active",
]);
const COMMON_SUBJECTS = new Set([
  "전사아키텍처 이해",
  "데이터 요건 분석",
  "데이터 표준화",
  "데이터 모델링",
]);
const DAP_ONLY_SUBJECTS = new Set([
  "데이터베이스 설계와 이용",
  "데이터 품질 관리 이해",
]);
const VERSION = "da-theories-2026.08.24.1";
const DEFAULT_OUTPUT = path.join(
  root,
  "apps/backend/resources/content/sources/da-theories-2026-08-24.json",
);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArguments() {
  const values = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--output") {
      index += 1;
      continue;
    }
    values.push(process.argv[index]);
  }
  return values;
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value !== ""));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function loadCsv(file) {
  const bytes = fs.readFileSync(file);
  const source = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/u, "")
    .replaceAll("\r\n", "\n");
  const [headers, ...values] = parseCsv(source);
  if (JSON.stringify(headers) !== JSON.stringify(EXPECTED_HEADERS)) {
    throw new Error(`${path.basename(file)} has an unsupported header`);
  }
  return {
    checksum: sha256(bytes),
    fileName: path.basename(file),
    rows: values.map((row, index) => {
      if (row.length !== headers.length) {
        throw new Error(`${path.basename(file)}:${index + 2} has ${row.length} columns`);
      }
      return Object.fromEntries(headers.map((header, column) => [header, row[column]]));
    }),
  };
}

function parsedBoolean(value, label) {
  if (/^(?:true|1)$/iu.test(value)) return true;
  if (/^(?:false|0)$/iu.test(value)) return false;
  throw new Error(`${label}.active is invalid`);
}

function theoryRow(row) {
  const id = Number(row.id);
  const sortOrder = Number(row.sortOrder);
  const label = `theory:${row.id}`;
  if (!Number.isInteger(id) || id < 1) throw new Error(`${label}.id is invalid`);
  if (!Number.isInteger(sortOrder) || sortOrder < 1) {
    throw new Error(`${label}.sortOrder is invalid`);
  }
  const expectedScope = COMMON_SUBJECTS.has(row.category)
    ? "DA"
    : DAP_ONLY_SUBJECTS.has(row.category)
      ? "DAP"
      : "";
  if (!expectedScope || row.examScope !== expectedScope) {
    throw new Error(`${label} has an invalid category/examScope pair`);
  }
  const keywords = JSON.parse(row.keywords);
  if (
    !Array.isArray(keywords)
    || keywords.length < 4
    || keywords.length > 10
    || keywords.some((keyword) => typeof keyword !== "string" || !keyword.trim())
  ) {
    throw new Error(`${label}.keywords must contain 4 to 10 non-empty strings`);
  }
  for (const field of ["title", "category", "topic", "summary", "content", "reviewAnswers"]) {
    if (!row[field].trim()) throw new Error(`${label}.${field} is required`);
  }
  if (!["## 핵심 요약", "## 학습 목표", "## 복습 문제"].every((heading) => (
    row.content.includes(heading)
  ))) {
    throw new Error(`${label}.content is missing a required heading`);
  }
  const review = splitTheoryReview(row.content, row.reviewAnswers);
  if (review.items.length < 4 || review.items.some((item) => !item.question || !item.answer)) {
    throw new Error(`${label} has an incompatible review section`);
  }
  return {
    id,
    title: row.title.trim(),
    category: row.category.trim(),
    topic: row.topic.trim(),
    examScope: row.examScope,
    summary: row.summary.trim(),
    content: row.content.trim(),
    reviewAnswers: row.reviewAnswers.trim(),
    keywords,
    sortOrder,
    active: parsedBoolean(row.active, label),
  };
}

const inputFiles = positionalArguments().map((file) => path.resolve(file));
if (!inputFiles.length) {
  throw new Error(
    "usage: node scripts/build-da-theory-import.mjs [--output file] <improved CSV>...",
  );
}
const inputs = inputFiles.map(loadCsv);
const theories = inputs.flatMap((input) => input.rows.map(theoryRow))
  .sort((left, right) => left.id - right.id);
const expectedIds = Array.from({ length: 61 }, (_, index) => 82_600_001 + index);
if (JSON.stringify(theories.map((theory) => theory.id)) !== JSON.stringify(expectedIds)) {
  throw new Error("DA theory IDs must be the complete 82600001-82600061 range");
}

const bundle = {
  schemaVersion: "baeumzip-content-import-v1",
  contentVersion: VERSION,
  reviewedAt: "2026-08-24",
  qualityReview: "passed",
  candidateUnitsExcluded: 14,
  scopePolicy: {
    DA: "Shared by DAsP and DAP",
    DAP: "DAP only",
  },
  sources: inputs.map((input) => ({
    fileName: input.fileName,
    rowCount: input.rows.length,
    sha256: input.checksum,
  })),
  theories,
};

const normalized = normalizeContentImport(bundle, "2026-08-24T00:00:00.000Z", {
  examTypes: REGISTERED_EXAM_TYPES,
  subjects: REGISTERED_SUBJECTS,
});
if (normalized.theories.length !== theories.length || normalized.questions.length !== 0) {
  throw new Error("Generated import bundle did not pass application normalization");
}

const output = path.resolve(option("--output") ?? DEFAULT_OUTPUT);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  contentVersion: VERSION,
  output,
  sourceFiles: inputs.length,
  theoryCount: theories.length,
}, null, 2));
