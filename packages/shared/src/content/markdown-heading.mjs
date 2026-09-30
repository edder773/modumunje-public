export function markdownHeadingId(value) {
  return `section-${value.normalize("NFKC").toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/[\s-]+/gu, "-") || "content"}`;
}

export function uniqueMarkdownHeadingIds(values) {
  const counts = new Map();
  return values.map((value) => {
    const base = markdownHeadingId(value);
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

export function learnerFacingMarkdown(value) {
  return value
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n+/u, "")
    .replace(/^#\s+[^\r\n]+\r?\n+/u, "")
    .replace(/^\s*<!--\s*source-item:[^>\r\n]+-->\s*$/gimu, "")
    .trimStart();
}

// Code comments must not consume heading IDs or appear in the reading outline.
export function markdownHeadingEntries(value) {
  const headings = [];
  let fence = null;
  for (const line of value.split(/\r?\n/u)) {
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/u);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = null;
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      fence = { marker: opening[1][0], length: opening[1].length };
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,3})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/u);
    if (heading) headings.push({ level: heading[1].length, label: heading[2].replace(/[*_`]/gu, "").trim() });
  }
  const ids = uniqueMarkdownHeadingIds(headings.map(({ label }) => label));
  return headings.map((heading, index) => ({ ...heading, id: ids[index] }));
}
