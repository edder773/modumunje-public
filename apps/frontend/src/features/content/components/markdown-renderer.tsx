"use client";

import {
  cloneElement,
  isValidElement,
  useMemo,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import katex from "katex";
import { normalizeLearningMarkdownSyntax } from "./markdown-syntax";
import { learnerFacingMarkdown, markdownHeadingEntries } from "@shared/content/markdown-heading.mjs";
import { remarkRepairBoldMarkers } from "@shared/content/remark-repair-bold.mjs";

function codeBlockLabel(language: string) {
  if (language === "sql") return "SQL";
  if (["plan", "execution-plan", "table"].includes(language)) return "EXECUTION PLAN / TABLE";
  return language && language !== "text" ? language.toUpperCase() : "CODE";
}

function MathFormula({ expression, display = false }: { expression: string; display?: boolean }) {
  const markup = katex.renderToString(expression.trim(), {
    displayMode: display, output: "mathml", throwOnError: false,
    trust: false, strict: "warn", maxExpand: 1000, maxSize: 20,
  });
  // KaTeX emits escaped MathML; trusted URL/HTML commands stay disabled.
  return <span className={display ? "math-block" : "math-inline"} dangerouslySetInnerHTML={{ __html: markup }} />;
}

function MarkdownCodeBlock({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{label}</span>
        <small>코드 영역 안에서 좌우로 이동할 수 있습니다.</small>
      </div>
      <pre tabIndex={0}>{isValidElement<{ className?: string }>(children)
        ? cloneElement(children, { className })
        : children}</pre>
    </div>
  );
}

const staticMarkdownComponents: Components = {
  p({ node, children }) {
    const onlyChild = node?.children.length === 1 ? node.children[0] : undefined;
    if (onlyChild?.type === "element" && onlyChild.tagName === "img") {
      return <>{children}</>;
    }
    return <p>{children}</p>;
  },
  pre({ children }) {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
    const className = code?.props.className ?? "language-text";
    const language = className.match(/(?:^|\s)language-(\S+)/u)?.[1].toLowerCase() ?? "text";
    if (language === "math") {
      return <div role="figure" aria-label="학습 수식"><MathFormula expression={String(code?.props.children ?? "")} display /></div>;
    }
    return <MarkdownCodeBlock label={codeBlockLabel(language)} className={className}>{code ?? children}</MarkdownCodeBlock>;
  },
  code({ className, children }) {
    if (className?.includes("math-inline")) return <MathFormula expression={String(children)} />;
    return <code className={className ?? "inline-code"}>{children}</code>;
  },
  table({ children }) {
    return <div className="markdown-table-wrap" role="group" aria-label="가로로 스크롤 가능한 표" tabIndex={0}><table>{children}</table></div>;
  },
  img({ alt, src, node: _node, ...props }) {
    void _node;
    const originalSrc = safeMarkdownImageSrc(src);
    if (!originalSrc) return null;
    if (/^\/(?:assets\/(?:soojebi-archive2|ipe\/practical-redrawn)|api\/private-diagrams\/ipe)\//u.test(originalSrc)) {
      return <span className="muted">이 자료의 그림 제공은 종료되었습니다.</span>;
    }
    const safeSrc = originalSrc;
    const imageAlt = alt ?? "학습 도식";
    const diagram = /^\/(?:api\/private-diagrams\/ipe\/|assets\/(?:ipe\/s[345]|ise\/p[12345])\/)/u.test(safeSrc);
    const image = (
      // eslint-disable-next-line @next/next/no-img-element
      <img {...props} src={safeSrc} alt={imageAlt} loading="lazy" decoding="async" />
    );
    return (
      <figure className={diagram ? "markdown-figure markdown-diagram" : "markdown-figure"}>
        {diagram && <div className="diagram-toolbar"><span>좌우로 이동해 그림을 확인하세요.</span><a className="diagram-enlarge" href={safeSrc.replace(/\.png$/u, ".svg")}>그림 크게 보기</a></div>}
        {diagram ? <div className="markdown-diagram-scroll" role="region" aria-label={`${imageAlt || "학습 도해"} — 좌우로 이동 가능`} tabIndex={0}>{image}</div> : image}
        {imageAlt && <figcaption>{imageAlt}</figcaption>}
      </figure>
    );
  },
};

function safeMarkdownHref(href: string | undefined) {
  const value = href?.trim();
  if (!value) return "";
  if (/^(?:javascript|data|vbscript):/iu.test(value)) return "";
  return value;
}

function safeMarkdownImageSrc(src: string | Blob | undefined) {
  if (typeof src !== "string") return "";
  const value = src.trim();
  if (!value || /^(?:javascript|data|vbscript|file):/iu.test(value)) return "";
  return value;
}

function isExternalHref(href: string) {
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("?") || href.startsWith(".")) {
    return false;
  }
  try {
    return new URL(href, "https://modumunje.com").origin !== "https://modumunje.com";
  } catch {
    return false;
  }
}

export default function MarkdownRenderer({ value }: { value: string }) {
  const learnerValue = useMemo(
    () => normalizeLearningMarkdownSyntax(learnerFacingMarkdown(value)),
    [value],
  );
  const headingIds = useMemo(
    () => markdownHeadingEntries(learnerValue).map(({ id }) => id),
    [learnerValue],
  );
  let headingIndex = 0;
  const components: Components = {
    ...staticMarkdownComponents,
    a({ children, href, node, ...props }) {
      // GFM can consume a Korean particle after a bare ASCII hostname. Explicit
      // Markdown links and URLs with paths keep their authored destinations.
      const original = learnerValue.slice(node?.position?.start.offset, node?.position?.end.offset);
      const bare = /^((?:https?:\/\/|www\.)[a-z\d.-]+\.[a-z]{2,})(으로|에서|로|에|와|과|은|는|을|를)$/iu.exec(original);
      const safeHref = safeMarkdownHref(bare ? (/^www\./iu.test(bare[1]) ? `http://${bare[1]}` : bare[1]) : href);
      if (!safeHref) return <span>{children}</span>;
      const external = isExternalHref(safeHref);
      return (
        <><a
          {...props}
          href={safeHref}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {bare ? bare[1] : children}
          {external && <span className="sr-only"> (새 창)</span>}
        </a>{bare?.[2]}</>
      );
    },
    h1({ children }) {
      return <h2 id={headingIds[headingIndex++]}>{children}</h2>;
    },
    h2({ children }) {
      return <h2 id={headingIds[headingIndex++]}>{children}</h2>;
    },
    h3({ children }) {
      return <h3 id={headingIds[headingIndex++]}>{children}</h3>;
    },
  };
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkRepairBoldMarkers]} components={components}>
      {learnerValue}
    </ReactMarkdown>
  );
}
