function inlineSegments(line: string): { code: boolean; text: string }[] {
  const segments: { code: boolean; text: string }[] = [];
  let cursor = 0;
  for (let start = 0; start < line.length; start += 1) {
    if (line[start] !== "`") continue;
    let length = 1;
    while (line[start + length] === "`") length += 1;
    let close = start + length;
    for (; close < line.length; close += 1) {
      if (line[close] !== "`") continue;
      let endLength = 1;
      while (line[close + endLength] === "`") endLength += 1;
      if (endLength === length) break;
      close += endLength - 1;
    }
    if (close >= line.length) { start += length - 1; continue; }
    if (start > cursor) segments.push({ code: false, text: line.slice(cursor, start) });
    cursor = close + length;
    segments.push({ code: true, text: line.slice(start, cursor) });
    start = cursor - 1;
  }
  if (cursor < line.length) segments.push({ code: false, text: line.slice(cursor) });
  return segments;
}

/** Repairs unambiguous imported notation without enabling raw HTML. */
export function normalizeLearningMarkdownSyntax(value: string) {
  let fence: { marker: string; length: number } | null = null;
  const lines = value.replace(/\r\n?/gu, "\n").split("\n");
  let tableColumns = 0;
  const escapePipes = (text: string) => text.replace(/(?<!\\)\|/gu, "\\|");
  return lines.map((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0], length: marker.length };
      else if (fence.marker === marker[0] && marker.length >= fence.length) fence = null;
      tableColumns = 0;
      return line;
    }
    if (fence) return line;
    const isDivider = (candidate: string) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(candidate);
    if (isDivider(lines[index + 1] ?? "")) tableColumns = line.split(/(?<!\\)\|/u).filter(cell => cell.trim()).length;
    else if (!line.includes("|") || !line.trim()) tableColumns = 0;
    const normalized = inlineSegments(line).map(({ code, text }) => {
      if (code) return tableColumns ? escapePipes(text) : text;
      // Decode only a literal code element, never arbitrary HTML or attributes.
      let prose = text.replace(/<code>([^<>`\n]*)<\/code>/gu, (_, literal: string) => {
        const decoded = literal.replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&#39;/gu, "'");
        return "`" + (tableColumns ? escapePipes(decoded) : decoded) + "`";
      }).replace(/\\\((.+?)\\\)/gu, (_, expression: string) => `$${expression}$`)
        .replace(/\\\[/gu, "$$").replace(/\\\]/gu, "$$")
        .replace(/(?<=[\p{L}\p{N}_])\$(?=[A-Za-z_])/gu, "\\$");
      if (tableColumns && !isDivider(line)) {
        prose = prose.replace(/\$[^$\n]+\$/gu, escapePipes)
          .replace(/\bP\([^()\n]*\|[^()\n]*\)/gu, escapePipes)
          .replace(/(^|[\s(=])\|([A-Za-z][\w]*(?:[+−-][\w]+)?)\|(?=[\s),.;]|$)/gu,
            (_, before: string, expression: string) => `${before}\\|${expression}\\|`);
      }
      return prose;
    }).join("");
    return normalized;
  }).join("\n");
}
