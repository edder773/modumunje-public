export function normalizeComparableContent(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*(?:```|~~~)[^\n]*$/gm, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

export function areEquivalentContents(first, second) {
  const normalizedFirst = normalizeComparableContent(first);
  const normalizedSecond = normalizeComparableContent(second);
  return Boolean(normalizedFirst)
    && Boolean(normalizedSecond)
    && normalizedFirst === normalizedSecond;
}

export function stripProblemApplicationSection(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const kept = [];
  let skippedHeadingLevel = 0;

  for (const line of lines) {
    const markdownHeading = line.match(
      /^\s*(#{1,6})\s*(?:\*\*|__)?\s*문제\s*풀이\s*적용\s*(?:\*\*|__)?\s*[:：-]?\s*#*\s*(?:.*)?$/,
    );
    const plainHeading = line.match(
      /^\s*(?:(?:\*\*|__)\s*)?문제\s*풀이\s*적용\s*(?:\*\*|__)?\s*[:：-]?\s*(?:.*)?$/,
    );
    if (markdownHeading || plainHeading) {
      skippedHeadingLevel = markdownHeading?.[1].length ?? 6;
      continue;
    }
    if (skippedHeadingLevel) {
      const nextHeading = line.match(/^\s*(#{1,6})\s+/);
      if (!nextHeading || nextHeading[1].length > skippedHeadingLevel) continue;
      skippedHeadingLevel = 0;
    }
    kept.push(line);
  }

  return kept.join("\n").trimEnd();
}

/**
 * Imported source documents occasionally left appendix labels in an
 * explanation. They are provenance metadata, not learner-facing content.
 */
export function stripSourceArtifactAppendix(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const markerIndex = lines.findIndex((line) => (
    /^\s*#{1,6}\s*\d+\s*부\s*[:：].*out\(\d+\)\.pdf/iu.test(line)
    || /^\s*[-*]?\s*수록\s*문항\s*[:：]/u.test(line)
    || /^\s*#{1,6}\s*출처\s*[:：].*\.pdf/iu.test(line)
  ));
  return (markerIndex >= 0 ? lines.slice(0, markerIndex) : lines)
    .join("\n")
    .replace(/(?:\n\s*---\s*)+$/g, "")
    .trimEnd();
}

export function stripTheoryLearningPositionSection(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const kept = [];
  let insideFence = false;
  let skippedHeadingLevel = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (/^(?:```|~~~)/u.test(trimmed)) {
      insideFence = !insideFence;
      if (!skippedHeadingLevel) kept.push(line);
      continue;
    }
    if (insideFence) {
      if (!skippedHeadingLevel) kept.push(line);
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s*학습\s*위치\s*#*\s*$/u);
    if (heading) {
      skippedHeadingLevel = heading[1].length;
      while (kept.at(-1)?.trim() === "") kept.pop();
      continue;
    }
    if (skippedHeadingLevel) {
      const nextHeading = line.match(/^\s*(#{1,6})\s+/u);
      if (!nextHeading || nextHeading[1].length > skippedHeadingLevel) continue;
      skippedHeadingLevel = 0;
      kept.push("");
    }
    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Difficulty and the generated "학습 위치" block are not learner-facing
 * theory content. Keep this legacy entry point so every import and renderer
 * applies the same cleanup rule.
 */
export function stripTheoryDifficultyMetadata(value) {
  const lines = stripTheoryLearningPositionSection(value).split("\n");
  let insideFence = false;
  return lines
    .filter((line) => {
      const text = line.trimStart();
      if (/^(?:```|~~~)/u.test(text)) {
        insideFence = !insideFence;
        return true;
      }
      return insideFence || !/^\|\s*난이도\s*\|[^|]*\|\s*$/u.test(text);
    })
    .join("\n")
    .trimEnd();
}

export function extractMarkdownSection(value, title) {
  const markdown = stripSourceArtifactAppendix(stripProblemApplicationSection(value));
  const escaped = String(title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = markdown.split("\n");
  let started = false;
  let headingLevel = 6;
  const body = [];

  for (const line of lines) {
    if (!started) {
      const markdownHeading = line.match(
        new RegExp(`^\\s*(#{1,6})\\s*(?:\\*\\*|__)?\\s*${escaped}\\s*(?:\\*\\*|__)?\\s*(?:[:：-]\\s*)?(.*)$`, "i"),
      );
      const plainHeading = line.match(
        new RegExp(`^\\s*(?:(?:\\*\\*|__)\\s*)?${escaped}\\s*(?:\\*\\*|__)?\\s*(?:[:：-]\\s*)?$`, "i"),
      );
      if (!markdownHeading && !plainHeading) continue;
      started = true;
      headingLevel = markdownHeading?.[1].length ?? 6;
      const inlineBody = markdownHeading?.[2]?.replace(/^(?:\*\*|__)\s*/, "").trim();
      if (inlineBody) body.push(inlineBody);
      continue;
    }

    const nextHeading = line.match(/^\s*(#{1,6})\s+/);
    if (nextHeading && nextHeading[1].length <= headingLevel) break;
    body.push(line);
  }

  return body.join("\n").trim();
}

export function extractModelAnswer(value) {
  const markdown = stripSourceArtifactAppendix(stripProblemApplicationSection(value));
  const section = (
    extractMarkdownSection(markdown, "모범답안과 상세 해설")
    || extractMarkdownSection(markdown, "모범답안")
    || extractMarkdownSection(markdown, "정답")
    || markdown
  ).trim();
  const repeatedLabel = section.match(
    /(?:^|\n)\s*(?:(?:\*\*|__)\s*)?모범답안\s*(?:\*\*|__)?\s*[:：]?\s*\n([\s\S]+)$/i,
  );
  return (repeatedLabel?.[1] ?? section).trim();
}

export function hasExplicitModelAnswerHeading(value) {
  return /(?:^|\n)#{1,6}\s*(?:모범\s*답안(?:\s*과\s*상세\s*해설)?|예시\s*답안|채점\s*답안)\s*(?:\n|$)/iu
    .test(String(value ?? ""));
}

function canonicalSql(value) {
  let sql = String(value ?? "")
    .replace(/^\s*(?:```|~~~)[^\n]*$/gm, " ")
    .replace(/\/\*\+\s*([\s\S]*?)\*\//g, " __optimizer_hint__ $1 __end_hint__ ")
    .replace(/\/\*(?!\+)[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  if (!/\b(?:select|insert|update|delete|merge|with)\b/.test(sql) && !sql.includes("__optimizer_hint__")) return "";

  sql = sql
    .replace(/\s*([(),;=<>+\-*/])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/;$/, "")
    .trim();

  // Reordering independent top-level AND predicates is a formatting-level
  // difference. Parenthesized or OR-heavy predicates remain AI-reviewed.
  const match = sql.match(/^(.*?\bwhere\b)(.*?)(\bgroup by\b|\bhaving\b|\border by\b|\bfetch\b|\bfor update\b|$)([\s\S]*)$/);
  if (match && !/[()]/.test(match[2]) && !/\bor\b/.test(match[2])) {
    const predicates = match[2].split(/\band\b/).map((item) => item.trim()).filter(Boolean);
    if (predicates.length > 1) {
      sql = `${match[1]} ${predicates.sort().join(" and ")} ${match[3]}${match[4]}`.trim();
    }
  }
  return sql.replace(/\s+/g, " ");
}

export function answersMatchReference(answer, reference) {
  if (areEquivalentContents(answer, reference)) return true;
  const answerSql = canonicalSql(answer);
  const referenceSql = canonicalSql(reference);
  return Boolean(answerSql) && Boolean(referenceSql) && answerSql === referenceSql;
}

function isStructuralMarkdown(text) {
  return /^(?:#{1,6}\s|[-*+]\s|>\s|\d+[.)]\s|\|)/.test(text);
}

function isCodeOrDiagramLine(text) {
  return /^(?:SELECT|INSERT|UPDATE|DELETE|MERGE|WITH|FROM|WHERE|JOIN|ON|GROUP\s+BY|ORDER\s+BY|HAVING|CREATE|ALTER|DROP|BEGIN|END|EXPLAIN|SQL>|PLAN_TABLE_OUTPUT|\+[-+]+\+|[-=]{3,})(?:\s|$)/i.test(text)
    || /(?:\|\s*[^|]+\s*\|)|(?:\S+\s{2,}\S+)/.test(text);
}

const INLINE_SECTION_TITLES = [
  "모범답안과 상세 해설",
  "오답 판단 포인트",
  "해설의 핵심",
  "상세 해설",
  "선택지 분석",
  "실전 점검",
  "채점 기준",
  "핵심 판단",
  "핵심 정리",
  "판단 근거",
];

function splitInlineSectionHeading(line) {
  for (const title of INLINE_SECTION_TITLES) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = line.match(new RegExp(`^(#{1,6}\\s*${escaped})(\\S[\\s\\S]*)$`));
    if (match) return `${match[1]}\n\n${match[2]}`;
  }
  return line;
}

function splitCircledNumberParagraphs(line) {
  const matches = [...line.matchAll(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g)];
  if (matches.length < 2) return line;

  const parts = [];
  const firstIndex = matches[0].index ?? 0;
  const prefix = line.slice(0, firstIndex).trimEnd();
  const isChoiceSeries = !prefix || /(?:선택지\s*분석|보기\s*분석)\s*[:：]?$/.test(prefix);
  if (!isChoiceSeries) return line;
  if (prefix) parts.push(prefix);
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? line.length;
    const item = line.slice(start, end).trim();
    if (item) parts.push(item);
  }
  return parts.join("\n\n");
}

function improveReadableProseLine(line) {
  return splitInlineSectionHeading(line)
    .split("\n")
    .map((part) => splitCircledNumberParagraphs(part))
    .join("\n");
}

const CIRCLED_CHOICE_PATTERN = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/;

function separateCircledChoiceLines(value) {
  const lines = String(value ?? "").split("\n");
  const output = [];
  let insideFence = false;

  for (const line of lines) {
    const text = line.trimStart();
    if (/^(?:```|~~~)/.test(text)) {
      insideFence = !insideFence;
      output.push(line);
      continue;
    }
    if (!insideFence && !text) {
      if (output.length && output.at(-1)?.trim()) output.push("");
      continue;
    }
    if (!insideFence && CIRCLED_CHOICE_PATTERN.test(text)) {
      if (output.length && output.at(-1)?.trim()) output.push("");
      output.push(text);
      output.push("");
      continue;
    }
    output.push(line);
  }

  return output.join("\n").trimEnd();
}

/**
 * Removes accidental indentation from prose without changing fenced code,
 * SQL, execution plans, tables, block quotes, or nested-list content.
 */
export function normalizeMarkdownProse(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  let insideFence = false;
  let listBaseIndent = null;

  const normalized = lines.map((line) => {
    const text = line.trimStart();
    if (/^(?:```|~~~)/.test(text)) {
      insideFence = !insideFence;
      listBaseIndent = null;
      return line;
    }
    if (insideFence || !text) {
      if (!text) listBaseIndent = null;
      return line;
    }

    const isList = /^(?:[-*+]\s|\d+[.)]\s)/.test(text);
    const indent = line.length - text.length;
    if (isList) {
      if (listBaseIndent === null) listBaseIndent = indent;
      const relativeIndent = Math.max(0, indent - listBaseIndent);
      return `${" ".repeat(relativeIndent)}${improveReadableProseLine(text)}`;
    }
    if (/^(?:#{1,6}\s|>\s|\|)/.test(text)) {
      listBaseIndent = null;
      return improveReadableProseLine(text);
    }
    if (isCodeOrDiagramLine(text)) {
      return line;
    }
    if (listBaseIndent !== null && indent > listBaseIndent) {
      return line.slice(listBaseIndent);
    }
    if (isStructuralMarkdown(text)) return improveReadableProseLine(text);
    listBaseIndent = null;
    return improveReadableProseLine(text);
  }).join("\n");

  return separateCircledChoiceLines(normalized);
}

const IMPORTED_QUESTION_HEADING = /^\s*#{1,6}\s+SQLP\s+(?:확장\s+문제|튜닝\s+실전)\s+\d+\s*(?:\n\s*)+/i;
const SOURCE_ITEM_COMMENT = /^\s*<!--\s*source-item:[^>\r\n]+-->\s*$/gimu;
const REVIEWED_BAE_SOURCE_ITEM_COMMENT = /^\s*<!--\s*source-item:BAE-W-[^>\r\n]+-->\s*$/imu;
const REVIEWED_IPE_SOURCE_ITEM_COMMENT = /^\s*<!--\s*source-item:IPE-S[1-5]-Q\d{4}\s*-->\s*$/imu;
const QUESTION_INSTRUCTION_ENDING = /(?:(?:고르시오|선택하시오|설명하시오|구하시오|판단하시오|판정하시오|작성하시오|튜닝하시오|수정하시오|제시하시오|답하시오|찾으시오|나열하시오|비교하시오|도출하시오|설계하시오|작성하라|설명하라|구하라|판단하라|판정하라|튜닝하라|수정하라|제시하라)|(?:(?:가장\s*)?(?:적절한|부적절한|올바른|옳은|틀린|잘못된)\s*(?:것은|것인가))|(?:무엇인가|어느\s*것인가|몇\s*건인가))\s*[.!?。]?\s*$/u;

function pipeRowCells(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.includes("|")) return null;
  const body = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = body.split("|").map((cell) => cell.trim());
  return cells.length >= 2 && cells.some(Boolean) ? cells : null;
}

function isPipeTableDelimiter(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

/**
 * Reviewed source sheets sometimes encode a table as aligned pipe rows but
 * omit the GFM delimiter row. Convert only multi-row, equal-width runs so an
 * ordinary sentence containing a pipe remains ordinary prose.
 */
export function normalizeLoosePipeTables(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let index = 0;
  let insideFence = false;

  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*(?:```|~~~)/u.test(line)) {
      insideFence = !insideFence;
      output.push(line);
      index += 1;
      continue;
    }
    const firstCells = insideFence ? null : pipeRowCells(line);
    if (!firstCells || isPipeTableDelimiter(firstCells)) {
      output.push(line);
      index += 1;
      continue;
    }

    const rows = [firstCells];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const cells = pipeRowCells(lines[cursor]);
      if (!cells || cells.length !== firstCells.length) break;
      rows.push(cells);
      cursor += 1;
    }
    if (rows.length < 2) {
      output.push(line);
      index += 1;
      continue;
    }

    output.push(`| ${rows[0].join(" | ")} |`);
    const hasDelimiter = isPipeTableDelimiter(rows[1]);
    output.push(hasDelimiter
      ? `| ${rows[1].join(" | ")} |`
      : `| ${rows[0].map(() => "---").join(" | ")} |`);
    for (const row of rows.slice(hasDelimiter ? 2 : 1)) {
      output.push(`| ${row.join(" | ")} |`);
    }
    index = cursor;
  }

  return output.join("\n");
}

function questionDisplayParts(stem, details) {
  return {
    stem,
    details: normalizeLoosePipeTables(details),
  };
}

function splitLongQuestionLead(lead, { separateQuestionContext = false } = {}) {
  let normalized = String(lead ?? "").trim();
  let suffixContext = "";
  const conditionSuffix = normalized.match(/\s*\((?:단|조건)\s*[,：:]?\s*([\s\S]+)\)\s*$/u);
  if (conditionSuffix && conditionSuffix.index !== undefined) {
    normalized = normalized.slice(0, conditionSuffix.index).trim();
    suffixContext = `조건: ${conditionSuffix[1].trim()}`;
  }
  if (!separateQuestionContext && normalized.length <= 110) {
    return { stem: normalized, context: suffixContext };
  }

  const sentences = normalized
    .split(/(?<=[.!?。])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  let instructionIndex = sentences.findLastIndex((sentence) => (
    QUESTION_INSTRUCTION_ENDING.test(sentence)
    && sentence.length >= 12
    && sentence.length <= 170
  ));
  if (
    instructionIndex < 0
    && sentences.length > 1
    && sentences.at(-1).length >= 12
    && sentences.at(-1).length <= 170
    && /[?？]\s*$/u.test(sentences.at(-1))
  ) instructionIndex = sentences.length - 1;
  if (separateQuestionContext) {
    instructionIndex = sentences.findLastIndex((sentence) => (
      sentence.length >= 12
      && sentence.length <= 170
      && (
        QUESTION_INSTRUCTION_ENDING.test(sentence)
        || /[?？]\s*$/u.test(sentence)
      )
    ));
  }
  if (instructionIndex >= 0) {
    const stem = sentences[instructionIndex].trim();
    const context = [
      sentences.slice(0, instructionIndex).join(" ").trim(),
      sentences.slice(instructionIndex + 1).join(" ").trim(),
      suffixContext,
    ].filter(Boolean).join("\n\n");
    if (stem.length <= 180 && context) return { stem, context };
  }

  const shortFinalQuestion = separateQuestionContext
    && sentences.length > 1
    && sentences.at(-1).length < 12
    && /[?？]\s*$/u.test(sentences.at(-1));
  if (shortFinalQuestion && normalized.length <= 180) {
    return { stem: normalized, context: suffixContext };
  }

  if (normalized.length <= 110) return { stem: normalized, context: suffixContext };

  const conciseInstruction = normalized.match(
    /((?:다음\s*중|아래|위|가장|어떤|무엇|어느|추가할|추가해야\s*할|수정할|튜닝할|설명할)[^.!?。\n]{8,160}(?:(?:고르시오|선택하시오|설명하시오|판단하시오|작성하시오|튜닝하시오|수정하시오|제시하시오|답하시오|찾으시오|도출하시오|설계하시오)|(?:(?:가장\s*)?(?:적절한|부적절한|올바른|옳은|틀린|잘못된)\s*(?:것은|것인가))|(?:무엇인가|어느\s*것인가|몇\s*건인가))\s*[.!?。]?)$/u,
  );
  if (conciseInstruction) {
    const stem = conciseInstruction[1].trim();
    const context = [
      normalized.slice(0, conciseInstruction.index).trim(),
      suffixContext,
    ].filter(Boolean).join("\n\n");
    if (stem && context) return { stem, context };
  }

  const sentenceBreaks = [...normalized.matchAll(/[.!?。]\s+/gu)]
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((index) => index >= 55 && index <= 170);
  const splitAt = sentenceBreaks.at(-1);
  if (splitAt) {
    return {
      stem: normalized.slice(0, splitAt).trim(),
      context: [normalized.slice(splitAt).trim(), suffixContext].filter(Boolean).join("\n\n"),
    };
  }

  return { stem: normalized, context: suffixContext };
}

/**
 * Keeps the actual question instruction concise while moving scenario,
 * conditions, SQL, plans, and tables into a separate learner-facing block.
 * No source content is discarded.
 */
export function splitQuestionPromptForDisplay(value) {
  const normalizedWithMetadata = normalizeMarkdownProse(value)
    .replace(IMPORTED_QUESTION_HEADING, "")
    .trim();
  const hasReviewedBaeSourceItem = REVIEWED_BAE_SOURCE_ITEM_COMMENT.test(normalizedWithMetadata);
  const hasReviewedIpeSourceItem = REVIEWED_IPE_SOURCE_ITEM_COMMENT.test(normalizedWithMetadata);
  const normalized = normalizedWithMetadata
    .replace(SOURCE_ITEM_COMMENT, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  SOURCE_ITEM_COMMENT.lastIndex = 0;
  if (!normalized) return { stem: "", details: "" };

  // The reviewed BAE bank stores optional stimulus material before the final
  // question and identifies the record with a source-item comment. Present
  // the final question as the stem, keep every preceding condition intact,
  // and never expose the internal marker to learners.
  if (hasReviewedBaeSourceItem) {
    const sourceBlocks = normalized.split(/\n\s*\n/u);
    if (sourceBlocks.length > 1) {
      const questionLead = sourceBlocks.pop()?.trim() ?? "";
      const splitLead = splitLongQuestionLead(questionLead);
      return questionDisplayParts(
        splitLead.stem,
        [
          sourceBlocks.join("\n\n").trim(),
          splitLead.context,
        ].filter(Boolean).join("\n\n"),
      );
    }
  }

  const blocks = normalized.split(/\n\s*\n/u);
  const lead = blocks.shift()?.trim() ?? "";
  let details = blocks.join("\n\n").trim();

  const leadLines = lead.split("\n");
  const firstLine = leadLines[0]?.trim() ?? "";
  if (
    leadLines.length > 1
    && firstLine.length >= 12
    && firstLine.length <= 170
    && (
      QUESTION_INSTRUCTION_ENDING.test(firstLine)
      || (
        /[?？]\s*$/u.test(firstLine)
        && /^(?:[A-Z]\.|[ㄱ-ㅎ]\.|[㉠-㉻①-⑳]|[-*+]\s)/u.test(leadLines[1].trim())
      )
    )
  ) {
    return questionDisplayParts(
      firstLine,
      [leadLines.slice(1).join("\n").trim(), details].filter(Boolean).join("\n\n"),
    );
  }

  const conditionHeading = lead.search(
    /\n\s*(?:#{1,6}\s*)?(?:주요\s*조건|조건|보기|자료|SQL|실행계획)\s*[:：]?\s*\n/iu,
  );
  let leadText = lead;
  if (conditionHeading > 0) {
    const embeddedDetails = lead.slice(conditionHeading).trim();
    leadText = lead.slice(0, conditionHeading).trim();
    details = [embeddedDetails, details].filter(Boolean).join("\n\n");
  }

  const headingWithBody = leadText.match(/^#{1,6}\s+([^\n]+)\n+([\s\S]+)$/u);
  if (headingWithBody && headingWithBody[1].trim().length <= 170) {
    return questionDisplayParts(
      headingWithBody[1].trim(),
      [headingWithBody[2].trim(), details].filter(Boolean).join("\n\n"),
    );
  }

  const fencedContextIndex = leadText.search(/\n\s*(?:```|~~~)/u);
  if (fencedContextIndex > 0) {
    return questionDisplayParts(
      leadText.slice(0, fencedContextIndex).trim(),
      [
        leadText.slice(fencedContextIndex).trim(),
        details,
      ].filter(Boolean).join("\n\n"),
    );
  }

  const splitLead = splitLongQuestionLead(leadText, {
    separateQuestionContext: hasReviewedIpeSourceItem,
  });
  return questionDisplayParts(
    splitLead.stem,
    [splitLead.context, details].filter(Boolean).join("\n\n"),
  );
}

/**
 * Explanations use ordinary paragraphs for short review checkpoints. This
 * keeps their left edge aligned with the detailed explanation while fenced
 * SQL, plans, tables, quotes, and real nested lists retain their structure.
 */
export function normalizeExplanationMarkdown(value) {
  const normalized = normalizeMarkdownProse(
    stripSourceArtifactAppendix(stripProblemApplicationSection(value)),
  ).replace(
    /^(#{1,6}\s+정답[^\n]*\n+)([^\n]+)(\n+#{1,6}\s+상세\s*해설[^\n]*\n+)#{1,6}\s+정답[^\n]*\n+\2\n+#{1,6}\s+상세\s*해설[^\n]*\n+/u,
    "$1$2$3",
  );
  const lines = normalized.split("\n");
  const output = [];
  let insideFence = false;
  let flattenCheckpoint = false;

  for (const line of lines) {
    const text = line.trimStart();
    if (/^(?:```|~~~)/.test(text)) {
      insideFence = !insideFence;
      output.push(line);
      continue;
    }
    if (!insideFence && !text) {
      if (output.length && output.at(-1)?.trim()) output.push("");
      continue;
    }
    if (!insideFence) {
      const heading = text.match(/^#{1,6}\s+(.+?)\s*#*$/);
      if (heading) {
        flattenCheckpoint = /^(?:오답 판단 포인트|실전 점검|채점 기준)$/.test(
          heading[1].replace(/\*\*|__/g, "").trim(),
        );
      }
      if (flattenCheckpoint && /^[-*+]\s+/.test(text)) {
        if (output.length && output.at(-1)?.trim()) output.push("");
        output.push(text.replace(/^[-*+]\s+/, ""));
        output.push("");
        continue;
      }
    }
    output.push(line);
  }

  return output.join("\n").trimEnd();
}
