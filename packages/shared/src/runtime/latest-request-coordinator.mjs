// @ts-check
/**
 * Keeps at most one active request per logical lane. A lease can still reject
 * after cancellation, so callers must check `isCurrent()` before mutating UI.
 */
export function createLatestRequestCoordinator() {
  /** @type {Map<string, { controller: AbortController, token: number }>} */
  const active = new Map();
  let token = 0;

  /** @param {string} scope */
  function cancel(scope, reason = "cancelled") {
    const current = active.get(scope);
    if (!current) return;
    active.delete(scope);
    current.controller.abort(reason);
  }

  /** @param {string} scope */
  function begin(scope) {
    cancel(scope, "superseded");
    const controller = new AbortController();
    const entry = { controller, token: ++token };
    active.set(scope, entry);
    return {
      signal: controller.signal,
      isCurrent() {
        return active.get(scope) === entry && !controller.signal.aborted;
      },
      finish() {
        if (active.get(scope) === entry) active.delete(scope);
      },
    };
  }

  function cancelAll(reason = "cancelled") {
    for (const scope of [...active.keys()]) cancel(scope, reason);
  }

  return { begin, cancel, cancelAll };
}

/** @param {unknown} error */
export function isExpectedRequestCancellation(error) {
  if (!error || typeof error !== "object") return false;
  return ("name" in error && error.name === "AbortError")
    || ("code" in error && error.code === "REQUEST_ABORTED");
}
