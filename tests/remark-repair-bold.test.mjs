import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkRepairBoldMarkers } from "../packages/shared/src/content/remark-repair-bold.mjs";

function renderMarkdown(value) {
  return renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm, remarkRepairBoldMarkers] },
      value,
    ),
  );
}

test("repairs bold markers next to Korean particles", () => {
  const html = renderMarkdown("**PGA(Process Global Area)**는 프로세스 전용 메모리다.");

  assert.match(html, /<strong>PGA\(Process Global Area\)<\/strong>는/);
  assert.doesNotMatch(html, /\*\*/);
});

test("repairs bold markers with inner spacing", () => {
  assert.equal(renderMarkdown("** 강조 내용 **"), "<p><strong>강조 내용</strong></p>");
});

test("does not alter technical asterisks or code", () => {
  assert.equal(renderMarkdown("SQL*Plus"), "<p>SQL*Plus</p>");
  assert.equal(renderMarkdown("B*Tree"), "<p>B*Tree</p>");
  assert.equal(renderMarkdown("COUNT(*)"), "<p>COUNT(*)</p>");
  assert.equal(
    renderMarkdown("`**literal**`"),
    "<p><code>**literal**</code></p>",
  );
  assert.equal(
    renderMarkdown("```text\n**literal**\n```"),
    "<pre><code class=\"language-text\">**literal**\n</code></pre>",
  );
});
