const CSV_HEADERS = {
  questions: [
    "id",
    "display_order",
    "exam_scope",
    "category",
    "topic",
    "kind",
    "difficulty",
    "prompt",
    "choices",
    "correct_answers",
    "explanation",
    "tags",
    "theory_id",
    "practice_scope",
    "variant_group_id",
    "active",
    "updated_at",
  ],
  theories: [
    "id",
    "sort_order",
    "exam_scope",
    "category",
    "topic",
    "difficulty",
    "title",
    "summary",
    "content",
    "review_answers",
    "keywords",
    "active",
    "updated_at",
  ],
  "sw-questions": [
    "id", "theory_id", "subject_group_id", "subject_id", "category", "topic",
    "display_order", "difficulty", "difficulty_rationale", "kind", "prompt",
    "choices", "correct_answers", "explanation", "tags", "required_concepts",
    "active", "created_at", "updated_at",
  ],
  "sw-theories": [
    "id", "subject_group_id", "subject_id", "category", "topic", "title",
    "summary", "content", "review_answers", "keywords", "sort_order", "active",
    "created_at", "updated_at",
  ],
};

function csvCell(value) {
  let cell = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (/^[=+\-@]/u.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}

export function exportHeaders(scope) {
  return CSV_HEADERS[scope] ?? [];
}

export function createExportDocument(scope, rows, exportedAt) {
  if (scope === "questions") {
    return { exportedAt, count: rows.length, questions: rows };
  }
  if (scope === "theories") {
    return { exportedAt, count: rows.length, theories: rows };
  }
  if (scope === "sw-questions") {
    return { exportedAt, count: rows.length, swQuestions: rows };
  }
  if (scope === "sw-theories") {
    return { exportedAt, count: rows.length, swTheories: rows };
  }
  throw new Error("행 단위 내보내기 대상을 확인할 수 없습니다.");
}

export function serializeRowsExport(scope, format, rows, exportedAt) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(scope.includes("questions")
      ? "내보낼 문제가 0건입니다. 문제은행 데이터를 다시 불러온 뒤 시도해 주세요."
      : "내보낼 이론이 0건입니다. 이론 데이터를 다시 불러온 뒤 시도해 주세요.");
  }
  if (format === "csv") {
    const headers = exportHeaders(scope);
    if (!headers.length) throw new Error("CSV 내보내기 대상을 확인할 수 없습니다.");
    return [
      headers.map(csvCell).join(","),
      ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
    ].join("\r\n");
  }
  return JSON.stringify(createExportDocument(scope, rows, exportedAt), null, 2);
}

const SUBJECT_FILE_SUFFIX = new Map([
  ["데이터 모델링의 이해", "subject-1"],
  ["SQL 기본 및 활용", "subject-2"],
  ["SQL 고급 활용 및 튜닝", "subject-3"],
  ["전사아키텍처 이해", "enterprise-architecture"],
  ["데이터 요건 분석", "data-requirements"],
  ["데이터 표준화", "data-standardization"],
  ["데이터 모델링", "data-modeling"],
  ["데이터베이스 설계와 이용", "database-design-and-use"],
  ["데이터 품질 관리 이해", "data-quality-management"],
]);

export function exportFilename(scope, format, exportedAt, category = "") {
  const extension = format === "csv" ? "csv" : "json";
  const date = new Date(exportedAt);
  const datePart = Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const subject = SUBJECT_FILE_SUFFIX.get(String(category))
    ?? String(category).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return `modu-workbook-${scope}${subject ? `-${subject}` : ""}-${datePart}.${extension}`;
}

export function adminExportHref(parameters = {}) {
  const scope = parameters.scope ?? "questions";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      query.set(key, String(value));
    }
  }
  query.set("scope", scope);
  query.set("resource", "export");
  return `/api/admin?${query.toString()}`;
}

export function createRowsExportStream({
  scope,
  format,
  total,
  exportedAt,
  pageSize = 75,
  loadPage,
}) {
  if (!Object.hasOwn(CSV_HEADERS, scope) || typeof loadPage !== "function") {
    throw new Error("행 단위 내보내기 설정이 유효하지 않습니다.");
  }
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(scope.includes("questions")
      ? "내보낼 문제가 0건입니다. 문제은행 데이터를 다시 확인해 주세요."
      : "내보낼 이론이 0건입니다. 이론 데이터를 다시 확인해 주세요.");
  }
  const encoder = new TextEncoder();
  const collectionKey = scope === "questions"
    ? "questions"
    : scope === "theories"
      ? "theories"
      : scope === "sw-questions"
        ? "swQuestions"
        : "swTheories";
  let offset = 0;
  let emitted = 0;
  let closed = false;
  return new ReadableStream({
    async pull(controller) {
      if (closed) return;
      try {
        const pageRows = await loadPage(offset, pageSize);
        const remaining = total - emitted;
        const rows = (Array.isArray(pageRows) ? pageRows : []).slice(0, remaining);
        if (!rows.length) {
          throw new Error(`내보내기 도중 데이터가 변경되어 ${total}건 중 ${emitted}건만 확인되었습니다.`);
        }
        if (format === "csv") {
          const serialized = serializeRowsExport(scope, "csv", rows, exportedAt);
          const firstLineEnd = serialized.indexOf("\r\n");
          const chunk = emitted === 0
            ? `\uFEFF${serialized}`
            : `\r\n${serialized.slice(firstLineEnd + 2)}`;
          controller.enqueue(encoder.encode(chunk));
        } else {
          const rowsJson = rows
            .map((row) => `    ${JSON.stringify(row)}`)
            .join(",\n");
          const prefix = emitted === 0
            ? `{\n  "exportedAt": ${JSON.stringify(exportedAt)},\n  "count": ${total},\n  "${collectionKey}": [\n`
            : ",\n";
          controller.enqueue(encoder.encode(`${prefix}${rowsJson}`));
        }
        emitted += rows.length;
        offset += pageRows.length;
        if (emitted >= total) {
          if (format !== "csv") controller.enqueue(encoder.encode("\n  ]\n}\n"));
          closed = true;
          controller.close();
        }
      } catch (error) {
        closed = true;
        controller.error(error);
      }
    },
  });
}
