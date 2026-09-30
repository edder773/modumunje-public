import assert from "node:assert/strict";
import test from "node:test";

type D1Result = {
  success: boolean;
  results: Array<Record<string, unknown>>;
  meta: { changes: number };
};

class QualityTestDatabase {
  questionScanCount = 0;
  private failQuestionScan = false;
  private pauseQuestionScan = false;
  private enteredPausedScan: (() => void) | undefined;
  private releasePausedScan: (() => void) | undefined;

  prepare(sql: string) {
    const statement = {
      bind() {
        return statement;
      },
      all: async (): Promise<D1Result> => {
        if (/FROM questions WHERE active = 1 ORDER BY id/u.test(sql)) {
          this.questionScanCount += 1;
          if (this.failQuestionScan) {
            this.failQuestionScan = false;
            throw new Error("quality scan failed");
          }
          if (this.pauseQuestionScan) {
            this.pauseQuestionScan = false;
            this.enteredPausedScan?.();
            await new Promise<void>((resolve) => {
              this.releasePausedScan = resolve;
            });
          }
        }
        return { success: true, results: [], meta: { changes: 0 } };
      },
      async run(): Promise<D1Result> {
        return { success: true, results: [], meta: { changes: 0 } };
      },
    };
    return statement;
  }

  async batch() {
    return [];
  }

  failNextScan() {
    this.failQuestionScan = true;
  }

  pauseNextScan() {
    this.pauseQuestionScan = true;
    const entered = new Promise<void>((resolve) => {
      this.enteredPausedScan = resolve;
    });
    return {
      entered,
      release: () => this.releasePausedScan?.(),
    };
  }
}

test("quality force refresh starts new completed scans while concurrent scans share in-flight work", async () => {
  const database = new QualityTestDatabase();
  const runtime = globalThis as typeof globalThis & {
    __BAEUMZIP_APP_VERSION__: string;
    __BAEUMZIP_ENV__: Record<string, unknown>;
  };
  runtime.__BAEUMZIP_APP_VERSION__ = "stage2-test";
  runtime.__BAEUMZIP_ENV__ = {
    DB: database as never,
    GOOGLE_AUTH_SESSION_SECRET: "stage2-session-secret-with-at-least-32-characters",
  };
  const {
    invalidateQualitySnapshot,
    readQuality,
  } = await import("../apps/backend/src/modules/admin/admin-quality-use-cases");

  await invalidateQualitySnapshot();
  assert.equal((await readQuality(true)).cached, false);
  assert.equal((await readQuality(true)).cached, false);
  assert.equal(database.questionScanCount, 2);

  assert.equal((await readQuality(false)).cached, true);
  assert.equal(database.questionScanCount, 2);

  const paused = database.pauseNextScan();
  const firstConcurrent = readQuality(true);
  await paused.entered;
  const secondConcurrent = readQuality(true);
  paused.release();
  const concurrentResults = await Promise.all([firstConcurrent, secondConcurrent]);
  assert.ok(concurrentResults.every((result) => result.cached === false));
  assert.equal(database.questionScanCount, 3);

  database.failNextScan();
  await assert.rejects(readQuality(true), /quality scan failed/u);
  assert.equal((await readQuality(true)).cached, false);
  assert.equal(database.questionScanCount, 5);
});
