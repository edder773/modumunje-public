"use client";

import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  adminExportHref,
  exportFilename,
} from "@shared/admin/admin-export.mjs";

export type JsonRecord = Record<string, unknown>;
export type LoadState<T> = {
  loading: boolean;
  error: string;
  data: T | null;
};

export type UserReportItem = {
  id: string;
  category: "bug" | "improvement" | "content";
  title: string;
  description: string;
  page_path: string;
  question_id: number | null;
  status: "new" | "reviewing" | "resolved";
  admin_note: string;
  anonymous_user: string;
  created_at: string;
  updated_at: string;
};

export function emptyLoad<T>(): LoadState<T> {
  return { loading: true, error: "", data: null };
}

async function responseError(response: Response) {
  try {
    const data = await response.json() as { error?: string };
    return data.error || `내보내기 요청이 실패했습니다. (${response.status})`;
  } catch {
    return `내보내기 요청이 실패했습니다. (${response.status})`;
  }
}

function saveDownload(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadAdminExport(
  parameters: Record<string, string>,
  onProgress?: (received: number, total: number) => void,
) {
  const scope = parameters.scope ?? "questions";
  const format = parameters.format === "csv" ? "csv" : "json";
  if (["questions", "theories", "sw-questions", "sw-theories"].includes(scope)) {
    const anchor = document.createElement("a");
    anchor.href = adminExportHref({ ...parameters, format });
    anchor.download = "";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    onProgress?.(0, 0);
    return null;
  }

  const query = new URLSearchParams({ ...parameters, resource: "export" });
  const response = await fetch(`/api/admin?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await responseError(response));
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const matchedName = disposition.match(/filename="([^"]+)"/iu)?.[1];
  saveDownload(
    blob,
    matchedName || exportFilename(
      scope,
      format,
      new Date().toISOString(),
      parameters.category,
    ),
    blob.type || "application/octet-stream",
  );
  return null;
}

export function ExportButton({
  parameters,
  children,
  className = "",
  onNotice,
}: {
  parameters: Record<string, string>;
  children: ReactNode;
  className?: string;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true);
    setProgress("");
    try {
      const count = await downloadAdminExport(parameters, (received, total) => {
        setProgress(total ? `${received}/${total}` : String(received));
      });
      onNotice(count === null ? "내보내기 파일을 생성했습니다." : `${count}건을 빠짐없이 내보냈습니다.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "데이터 내보내기에 실패했습니다.", true);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  return (
    <button className={className} type="button" disabled={busy} onClick={() => void download()}>
      {busy ? `내보내는 중${progress ? ` ${progress}` : "…"}` : children}
    </button>
  );
}

export function ExportLink({
  parameters,
  children,
  className = "",
  onNotice,
}: {
  parameters: Record<string, string>;
  children: ReactNode;
  className?: string;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const scope = parameters.scope ?? "questions";
  return (
    <a
      className={className}
      data-export-scope={scope}
      href={adminExportHref(parameters)}
      onClick={() => {
        onNotice(
          scope === "questions"
            ? "전체 문제 JSON 생성을 시작했습니다."
            : "데이터 파일 생성을 시작했습니다.",
        );
      }}
    >
      {children}
    </a>
  );
}

export function formatDate(value: unknown, includeTime = true) {
  if (!value) return "기록 없음";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

export function daysAgoLabel(value: unknown) {
  if (!value) return "백업 없음";
  const target = new Date(String(value));
  if (!Number.isFinite(target.getTime())) return "백업 없음";
  const koreaDay = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  };
  const elapsedDays = Math.max(0, Math.floor((koreaDay(new Date()) - koreaDay(target)) / 86_400_000));
  return elapsedDays === 0 ? "오늘" : `${elapsedDays}일 전`;
}

export function formatBytes(value: unknown) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function statusLabel(value: unknown) {
  if (value === "completed") return "완료";
  if (value === "creating") return "생성 중";
  if (value === "failed") return "실패";
  if (value === "active") return "진행 중";
  if (value === "blocked") return "차단됨";
  if (value === "resolved") return "해결";
  if (value === "reviewing") return "검토 중";
  if (value === "new") return "신규";
  if (value === "ignored") return "무시";
  if (value === "open") return "확인 필요";
  return String(value ?? "-");
}

export function withObjectParticle(value: string) {
  const last = [...value.trim()].at(-1) ?? "";
  const code = last.charCodeAt(0);
  const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${value}${hasBatchim ? "을" : "를"}`;
}

export function AdminNotice({
  message,
  error = false,
  onClose,
}: {
  message: string;
  error?: boolean;
  onClose: () => void;
}) {
  if (!message) return null;
  return (
    <div className={error ? "admin-toast error" : "admin-toast"} role="status">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="알림 닫기">×</button>
    </div>
  );
}

export function LoadingBlock({ label = "데이터를 불러오는 중입니다." }: { label?: string }) {
  return <div className="admin-loading" role="status"><i /><span>{label}</span></div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="admin-empty">
      <span aria-hidden="true">—</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="admin-empty error">
      <span aria-hidden="true">!</span>
      <strong>데이터를 불러오지 못했습니다.</strong>
      <p>{message}</p>
      <button className="admin-button" type="button" onClick={onRetry}>다시 시도</button>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    const closeButton = dialog?.querySelector<HTMLElement>("[data-admin-modal-close]");
    document.body.style.overflow = "hidden";
    closeButton?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section
        ref={dialogRef}
        className={wide ? "admin-modal wide" : "admin-modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button data-admin-modal-close type="button" onClick={onClose} aria-label={`${title} 닫기`}>×</button>
        </header>
        <div className="admin-modal-body">{children}</div>
      </section>
    </div>
  );
}

export function MarkdownPreview({ value }: { value: string }) {
  return (
    <div className="admin-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value || "미리 볼 내용이 없습니다."}</ReactMarkdown>
    </div>
  );
}
