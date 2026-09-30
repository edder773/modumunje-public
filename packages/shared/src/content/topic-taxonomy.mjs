const DEFINITIONS = Object.freeze([
  {
    id: "data-modeling-normalization",
    category: "데이터 모델링의 이해",
    label: "정규화와 반정규화",
    aliases: ["정규화와 반정규화", "정규화"],
  },
  {
    id: "sql-basic-window-functions",
    category: "SQL 기본 및 활용",
    label: "윈도우 함수",
    aliases: ["윈도우 함수", "분석 함수"],
  },
  {
    id: "sql-basic-tcl",
    category: "SQL 기본 및 활용",
    label: "TCL",
    aliases: ["TCL", "트랜잭션", "트랜잭션과 DDL"],
  },
  {
    id: "sql-basic-grouping",
    category: "SQL 기본 및 활용",
    label: "GROUP BY와 HAVING",
    aliases: ["GROUP BY와 HAVING", "SQL 문법"],
  },
  {
    id: "sql-basic-ddl",
    category: "SQL 기본 및 활용",
    label: "DDL",
    aliases: ["DDL", "DDL과 제약조건"],
  },
  {
    id: "sql-basic-where",
    category: "SQL 기본 및 활용",
    label: "WHERE 절",
    aliases: ["WHERE 절"],
  },
  {
    id: "sql-tuning-index-foundations",
    category: "SQL 고급 활용 및 튜닝",
    label: "인덱스 기본 원리",
    aliases: ["인덱스 기본 원리", "인덱스"],
  },
  {
    id: "sql-tuning-join-strategy",
    category: "SQL 고급 활용 및 튜닝",
    label: "조인 순서와 조인 방식",
    aliases: ["조인 순서와 조인 방식", "조인"],
  },
  {
    id: "sql-tuning-partitioning",
    category: "SQL 고급 활용 및 튜닝",
    label: "파티셔닝",
    aliases: ["파티셔닝", "Table Partitioning"],
  },
  {
    id: "sql-tuning-parallel-execution",
    category: "SQL 고급 활용 및 튜닝",
    label: "병렬 처리",
    aliases: ["병렬 처리", "Parallel Execution"],
  },
  {
    id: "sql-tuning-hash-join",
    category: "SQL 고급 활용 및 튜닝",
    label: "해시 조인",
    aliases: ["해시 조인", "Hash Join"],
  },
  {
    id: "sql-tuning-nested-loops",
    category: "SQL 고급 활용 및 튜닝",
    label: "NL 조인",
    aliases: ["NL 조인", "Nested Loops Join"],
  },
  {
    id: "sql-tuning-locks",
    category: "SQL 고급 활용 및 튜닝",
    label: "Lock",
    aliases: ["Lock", "Oracle Lock"],
  },
  {
    id: "sql-tuning-transactions",
    category: "SQL 고급 활용 및 튜닝",
    label: "트랜잭션",
    aliases: ["트랜잭션", "격리 수준"],
  },
]);

function normalizedTaxonomyValue(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("ko-KR");
}

const LOOKUP = new Map(
  DEFINITIONS.flatMap((definition) => definition.aliases.map((alias) => [
    `${normalizedTaxonomyValue(definition.category)}:${normalizedTaxonomyValue(alias)}`,
    definition,
  ])),
);

const CONTEXTUAL_LOOKUP = new Map([
  [
    `${normalizedTaxonomyValue("SQL 기본 및 활용")}:${normalizedTaxonomyValue("SELECT")}:802`,
    DEFINITIONS.find((definition) => definition.id === "sql-basic-where"),
  ],
]);


/**
 * @param {unknown} category
 * @param {unknown} topic
 * @param {unknown} [theoryId]
 */
export function canonicalTopic(category, topic, theoryId = null) {
  const categoryValue = String(category ?? "").trim();
  const topicValue = String(topic ?? "").trim() || "미분류";
  const lookupKey = `${normalizedTaxonomyValue(categoryValue)}:${normalizedTaxonomyValue(topicValue)}`;
  const contextualKey = `${lookupKey}:${Number(theoryId) || 0}`;
  const definition = CONTEXTUAL_LOOKUP.get(contextualKey) ?? LOOKUP.get(lookupKey);
  if (definition) return { id: definition.id, label: definition.label };
  return {
    id: `legacy:${normalizedTaxonomyValue(categoryValue)}:${normalizedTaxonomyValue(topicValue)}`,
    label: topicValue,
  };
}

/**
 * @param {unknown} category
 * @param {unknown} topic
 * @param {unknown} [theoryId]
 */
export function canonicalTopicId(category, topic, theoryId = null) {
  return canonicalTopic(category, topic, theoryId).id;
}

/**
 * @param {unknown} category
 * @param {unknown} topic
 * @param {unknown} [theoryId]
 */
export function canonicalTopicLabel(category, topic, theoryId = null) {
  return canonicalTopic(category, topic, theoryId).label;
}
