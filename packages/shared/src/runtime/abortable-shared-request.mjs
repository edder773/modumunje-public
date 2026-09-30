function abortError() {
  return new DOMException("요청이 취소되었습니다.", "AbortError");
}

export function waitForSharedRequest(pending, signal) {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(
      (payload) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(payload);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}
