const MAX_UPLOADS = 4;

/** Keeps at most four serialized backup parts in flight. */
export class BackupUploadQueue {
  private readonly pending = new Set<Promise<void>>();
  private failed = false;
  private failure: unknown;
  private pendingBytes = 0;
  peakBytes = 0;

  async add(byteSize: number, upload: () => Promise<void>) {
    while (this.pending.size >= MAX_UPLOADS) await Promise.race(this.pending);
    if (this.failed) throw this.failure;
    this.pendingBytes += byteSize;
    this.peakBytes = Math.max(this.peakBytes, this.pendingBytes);
    const work = Promise.resolve().then(upload).catch((error: unknown) => {
      if (!this.failed) this.failure = error;
      this.failed = true;
    }).finally(() => {
      this.pendingBytes -= byteSize;
      this.pending.delete(work);
    });
    this.pending.add(work);
  }

  async settled() {
    await Promise.all(this.pending);
  }

  async drain() {
    await this.settled();
    if (this.failed) throw this.failure;
  }
}
