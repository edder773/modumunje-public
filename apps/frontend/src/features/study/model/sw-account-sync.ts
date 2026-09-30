/** Single-flight account import; a failed import must never be hidden by a successful read. */
export function createSwAccountSync<T>(options: {
  snapshot: () => string;
  importSnapshot: (snapshot: string, signal: AbortSignal) => Promise<unknown>;
  accountFromImport?: (result: unknown) => T | undefined;
  readAccount: (signal: AbortSignal) => Promise<T>;
  applyAccount: (account: T) => void;
  onBusy: (busy: boolean) => void;
  onError: (error: unknown | null) => void;
}) {
  let complete = false;
  let importedSnapshot: string | undefined;
  let controller: AbortController | undefined;
  let pending: Promise<boolean> | undefined;

  function run(): Promise<boolean> {
    if (complete) return Promise.resolve(true);
    if (pending) return pending;
    const current = new AbortController();
    controller = current;
    const isCurrent = () => controller === current && !current.signal.aborted;
    options.onBusy(true);
    pending = Promise.resolve().then(async () => {
      if (!isCurrent()) return false;
      const snapshot = options.snapshot();
      let accountFromImport: T | undefined;
      if (snapshot !== importedSnapshot) {
        const result = await options.importSnapshot(snapshot, current.signal);
        if (!isCurrent()) return false;
        accountFromImport = options.accountFromImport?.(result);
        importedSnapshot = snapshot;
      }
      const account = accountFromImport ?? await options.readAccount(current.signal);
      if (!isCurrent()) return false;
      options.applyAccount(account);
      complete = true;
      options.onError(null);
      return true;
    }).catch((error: unknown) => {
      if (isCurrent()) options.onError(error);
      return false;
    }).finally(() => {
      if (controller !== current) return;
      pending = undefined;
      controller = undefined;
      options.onBusy(false);
    });
    return pending;
  }

  return {
    run,
    cancel() {
      controller?.abort("unmount");
      controller = undefined;
      pending = undefined;
    },
  };
}
