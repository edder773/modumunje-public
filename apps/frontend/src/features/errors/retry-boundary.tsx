"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type RetryBoundaryProps = {
  children: ReactNode;
  fallbackTitle: string;
  resetKey?: string | number;
};

type RetryBoundaryState = {
  failed: boolean;
};

const CHUNK_RELOAD_KEY = "baeumzip:chunk-reload-attempted";
const CHUNK_RELOAD_QUERY = "__baeumzip_reload";
const CHUNK_RELOAD_GUARD_MS = 30_000;
const CHUNK_RELOAD_STABLE_MS = 10_000;

export function isChunkLoadError(error: unknown) {
  const description = error instanceof Error
    ? `${error.name} ${error.message}`
    : String(error ?? "");
  return /chunkloaderror|loading chunk|dynamically imported module|module script failed|failed to fetch module|\/_next\/static\//iu.test(
    description,
  );
}

function requestDeploymentReload(force = false) {
  const previous = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY));
  const timestamp = Date.now();
  if (!force && Number.isFinite(previous) && timestamp - previous < CHUNK_RELOAD_GUARD_MS) return false;
  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(timestamp));
  const url = new URL(window.location.href);
  url.searchParams.set(CHUNK_RELOAD_QUERY, String(timestamp));
  window.location.replace(url.toString());
  return true;
}

function failedStaticAsset(event: Event) {
  const target = event.target;
  if (target instanceof HTMLScriptElement) return target.src;
  if (target instanceof HTMLLinkElement && target.rel === "stylesheet") return target.href;
  return "";
}

export function installStaleDeploymentRecovery() {
  const onResourceError = (event: Event) => {
    const asset = failedStaticAsset(event);
    if (asset.includes("/_next/static/")) requestDeploymentReload();
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (isChunkLoadError(event.reason) && requestDeploymentReload()) event.preventDefault();
  };
  const onPreloadError = (event: Event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (isChunkLoadError(payload) && requestDeploymentReload()) event.preventDefault();
  };
  window.addEventListener("error", onResourceError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => {
    window.removeEventListener("error", onResourceError, true);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    window.removeEventListener("vite:preloadError", onPreloadError);
  };
}

export default class RetryBoundary extends Component<RetryBoundaryProps, RetryBoundaryState> {
  state: RetryBoundaryState = { failed: false };
  private stableTimer: number | null = null;

  componentDidMount() {
    this.stableTimer = window.setTimeout(() => {
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      const url = new URL(window.location.href);
      if (!url.searchParams.has(CHUNK_RELOAD_QUERY)) return;
      url.searchParams.delete(CHUNK_RELOAD_QUERY);
      window.history.replaceState(window.history.state, "", url.toString());
    }, CHUNK_RELOAD_STABLE_MS);
  }

  static getDerivedStateFromError(): RetryBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(JSON.stringify({
      level: "error",
      event: "client_render_failed",
      errorName: error.name,
      componentStackAvailable: Boolean(info.componentStack),
    }));
    if (isChunkLoadError(error)) requestDeploymentReload();
  }

  componentDidUpdate(previousProps: RetryBoundaryProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      this.setState({ failed: false });
    }
  }

  componentWillUnmount() {
    if (this.stableTimer !== null) window.clearTimeout(this.stableTimer);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="inline-error-boundary" role="alert">
        <strong>{this.props.fallbackTitle}</strong>
        <p>잠시 후 다시 시도해 주세요. 작성하거나 선택한 학습 상태는 유지됩니다.</p>
        <button type="button" onClick={() => {
          requestDeploymentReload(true);
        }}>
          다시 시도
        </button>
      </section>
    );
  }
}
