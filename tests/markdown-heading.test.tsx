import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownRenderer from "../apps/frontend/src/features/content/components/markdown-renderer";
import { learnerFacingMarkdown, markdownHeadingEntries } from "../packages/shared/src/content/markdown-heading.mjs";
import { theoryTocItems } from "../apps/frontend/src/features/study/components/study-screen-shared";

test("Python comments inside fenced code cannot shift theory heading anchors", () => {
  const value = ["# 문서 제목", "", "## 바인딩", "", "```python", "# 코드 주석", "print(1)", "```", "", "## ORM", "", "~~~~text", "### 예제", "~~~", "# 여전히 코드", "~~~~", "", "## ORM"].join("\n");
  const entries = markdownHeadingEntries(learnerFacingMarkdown(value));
  assert.deepEqual(entries.map(({ id }) => id), ["section-바인딩", "section-orm", "section-orm-2"]);
  const html = renderToStaticMarkup(<MarkdownRenderer value={value} />);
  for (const { id } of entries) assert.ok(html.includes(`id="${id}"`), id);
  assert.equal((html.match(/<h[23] /gu) ?? []).length, 3);
  assert.deepEqual(theoryTocItems(value).map(({ id }) => id), entries.map(({ id }) => id));
});

test("indented fenced examples and closing heading markers preserve duplicate heading IDs", () => {
  const value = "## **조건** ##\n\n   ```python\n## 제외\n   ```\n\n### 조건\n";
  const entries = markdownHeadingEntries(value);
  assert.deepEqual(entries.map(({ id }) => id), ["section-조건", "section-조건-2"]);
  const html = renderToStaticMarkup(<MarkdownRenderer value={value} />);
  for (const { id } of entries) assert.ok(html.includes(`id="${id}"`));
});


test("markdown links and images keep safe attributes without serializing their AST node", () => {
  const html = renderToStaticMarkup(<MarkdownRenderer value={'[외부](https://example.com)\n\n![도식](/assets/example.svg)'} />);
  assert.doesNotMatch(html, /\bnode=/u);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/u);
  assert.match(html, /alt="도식"/u);
});

test("inline and nested display math render MathML while SQL identifiers and code remain literal", () => {
  const value = String.raw`확률 $P(Y\mid X)$ 와 V$SESSION, V$SQL을 확인합니다.

$$
\frac{1}{\sqrt{1+x^2}}
$$` + "\n\n`V$SESSION || V$SQL`";
  const html = renderToStaticMarkup(<MarkdownRenderer value={value} />);
  assert.match(html, /<math\b/u);
  assert.match(html, /<mfrac>/u);
  assert.match(html, /<msqrt>/u);
  assert.match(html, /V\$SESSION, V\$SQL/u);
  assert.match(html, /<code[^>]*>V\$SESSION \|\| V\$SQL<\/code>/u);
  assert.doesNotMatch(html, /katex-error/u);
});

test("GFM tables retain notation, alignment and complete cell contents", () => {
  const value = '| 표기 | 뜻 |\n| :--- | ---: |\n| `x || y` | 논리 OR |\n| P(Y|X) | 조건부 확률 |\n| |x| | 절댓값 |\n| <code>&amp;&amp;</code> | 논리 AND |';
  const html = renderToStaticMarkup(<MarkdownRenderer value={value} />);
  assert.equal((html.match(/<td\b/gu) ?? []).length, 8);
  for (const text of ['x || y', 'P(Y|X)', '|x|', '&amp;&amp;']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /&lt;code&gt;/u);
  assert.match(html, /text-align:right/u);
});

test("math macros cannot create trusted links or injected HTML", () => {
  const html = renderToStaticMarkup(<MarkdownRenderer value={String.raw`$\href{javascript:alert(1)}{x}$`} />);
  assert.doesNotMatch(html, /href=["']javascript:|<script\b/u);
});

test("TeX bracket delimiters render while multi-backtick code spans remain intact", () => {
  const value = String.raw`inline \(\frac{a}{b}\) end

\[
\sqrt{x}
\]

| 이름 | 값 |
| --- | --- |
| a | ` + '``x ` | y`` |';
  const html = renderToStaticMarkup(<MarkdownRenderer value={value} />);
  assert.equal((html.match(/<math\b/gu) ?? []).length, 2);
  assert.match(html, /<code[^>]*>x ` \| y<\/code>/u);
  assert.equal((html.match(/<td\b/gu) ?? []).length, 2);
});


test("bare hostname links keep adjacent Korean particles outside the destination", () => {
  const html = renderToStaticMarkup(<MarkdownRenderer value={"www.example.com으로 이동하고 https://example.org에서 읽습니다."} />);
  assert.match(html, /href="http:\/\/www\.example\.com"/u);
  assert.match(html, /<\/a>으로/u);
  assert.match(html, /href="https:\/\/example\.org"/u);
  assert.match(html, /<\/a>에서/u);
  assert.doesNotMatch(html, /%EC%9C%BC%EB%A1%9C|%EC%97%90%EC%84%9C/iu);
  const authored = renderToStaticMarkup(<MarkdownRenderer value={"[문서](https://example.com/자료로) · https://example.com/자료로 · https://한글.kr · `www.example.com으로`"} />);
  assert.equal((authored.match(/href="https:\/\/example\.com\/%EC%9E%90%EB%A3%8C%EB%A1%9C"/gu) ?? []).length, 2);
  assert.match(authored, /href="https:\/\/%ED%95%9C%EA%B8%80\.kr"/u);
  assert.match(authored, /<code[^>]*>www\.example\.com으로<\/code>/u);
});
