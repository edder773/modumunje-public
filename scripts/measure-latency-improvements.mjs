import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openCanonicalDatabase } from "./lib/canonical-database.mjs";

const root = path.resolve(import.meta.dirname, "..");
const database = openCanonicalDatabase(root);

class SqliteD1Statement {
  constructor(sql) {
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  execute() {
    const statement = database.prepare(this.sql);
    const results = statement.all(...this.values);
    const meta = database.prepare("SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid").get();
    return {
      success: true,
      results,
      meta: {
        changes: Number(meta.changes),
        last_row_id: Number(meta.lastInsertRowid),
      },
    };
  }

  async all() {
    return this.execute();
  }

  async first(column) {
    const row = database.prepare(this.sql).get(...this.values) ?? null;
    return column && row ? row[column] : row;
  }

  async raw() {
    return database.prepare(this.sql).all(...this.values).map((row) => Object.values(row));
  }

  async run() {
    return this.execute();
  }
}

const d1 = {
  prepare(sql) {
    return new SqliteD1Statement(sql);
  },
  async batch(statements) {
    database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
};

function sessionCookie(email, secret) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const encoded = Buffer.from(JSON.stringify({
    v: 1,
    sub: crypto.randomUUID(),
    email,
    name: "Latency benchmark",
    iat: issuedAt,
    exp: issuedAt + 3_600,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `__Host-baeumzip-google-session=${encoded}.${signature}`;
}

async function workerInstance(label) {
  const url = pathToFileURL(path.join(root, "dist/server/index.js"));
  url.searchParams.set("latency-measurement", `${label}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function timedFetch(worker, request, environment, context) {
  const startedAt = performance.now();
  const response = await worker.fetch(request, environment, context);
  const body = await response.json();
  return {
    body,
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    status: response.status,
  };
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(samples, budgetMs) {
  const durations = samples.map((sample) => sample.durationMs);
  const p50Ms = percentile(durations, 0.5);
  const p95Ms = percentile(durations, 0.95);
  return {
    samples: samples.length,
    p50Ms,
    p95Ms,
    maxMs: Math.max(...durations),
    budgetMs,
    passed: p95Ms <= budgetMs,
  };
}

async function repeat(count, operation) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    samples.push(await operation(index));
  }
  return samples;
}

function requireStatus(sample, allowed, label) {
  if (!allowed.includes(sample.status)) {
    throw new Error(`${label} returned ${sample.status}: ${JSON.stringify(sample.body)}`);
  }
  return sample;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const secret = "local-latency-benchmark-secret-at-least-32-characters";
const adminEmail = "admin-latency@example.test";
const learnerEmail = "learner-latency@example.test";
const environment = {
  DB: d1,
  ADMIN_EMAIL: adminEmail,
  GOOGLE_AUTH_SESSION_SECRET: secret,
};
const context = { waitUntil() {}, passThroughOnException() {} };

try {
  const firstWorker = await workerInstance("fresh");
  const adminCookie = sessionCookie(adminEmail, secret);
  const learnerCookie = sessionCookie(learnerEmail, secret);
  const freshQualitySamples = await repeat(
    5,
    async () => requireStatus(await timedFetch(
      firstWorker,
      new Request("https://modumunje.com/api/admin?resource=quality&refresh=1", {
        headers: { cookie: adminCookie },
      }),
      environment,
      context,
    ), [200], "fresh quality"),
  );

  const secondWorker = await workerInstance("durable-cache");
  const cachedQualitySamples = await repeat(
    10,
    async () => {
      const sample = requireStatus(await timedFetch(
        secondWorker,
        new Request("https://modumunje.com/api/admin?resource=quality", {
          headers: { cookie: adminCookie },
        }),
        environment,
        context,
      ), [200], "cached quality");
      if (sample.body.cached !== true) throw new Error(`cached quality missed: ${JSON.stringify(sample.body)}`);
      return sample;
    },
  );

  const adminQuestionSamples = await repeat(
    10,
    async () => requireStatus(await timedFetch(
      secondWorker,
      new Request("https://modumunje.com/api/admin?resource=questions&page=1&pageSize=25", {
        headers: { cookie: adminCookie },
      }),
      environment,
      context,
    ), [200], "admin questions"),
  );

  const practiceSamples = await repeat(
    10,
    async () => requireStatus(await timedFetch(
      secondWorker,
      new Request("https://modumunje.com/api/study?scope=practice&exam=BAE&kind=objective&limit=1", {
        headers: { cookie: learnerCookie },
      }),
      environment,
      context,
    ), [200], "practice read"),
  );
  const question = practiceSamples[0].body.questions?.[0];
  if (!question?.feedbackAuthorization) {
    throw new Error(`practice question authorization missing: ${JSON.stringify(practiceSamples[0].body)}`);
  }
  const answerCheckSamples = await repeat(
    10,
    async () => requireStatus(await timedFetch(
      secondWorker,
      new Request("https://modumunje.com/api/study", {
        method: "POST",
        headers: {
          cookie: learnerCookie,
          "Content-Type": "application/json",
          "x-sql-study-user-request": "1",
        },
        body: JSON.stringify({
          action: "attempt",
          questionId: question.id,
          examType: "BAE",
          selectedAnswers: [0],
          mode: "practice",
          clientOperationId: `latency-${crypto.randomUUID()}`,
          feedbackAuthorization: question.feedbackAuthorization,
        }),
      }),
      environment,
      context,
    ), [200, 201], "answer check"),
  );

  const metrics = {
    // Five nearest-rank p95 samples make the result equal to the single slowest
    // uncached refresh. Keep a strict ceiling while allowing normal shared-runner
    // scheduling jitter; the user-facing durable-cache budget remains 250ms.
    freshQuality: summarize(freshQualitySamples, 3_500),
    durableQualityCache: summarize(cachedQualitySamples, 250),
    adminQuestions: summarize(adminQuestionSamples, 750),
    practiceRead: summarize(practiceSamples, 750),
    answerCheck: summarize(answerCheckSamples, 500),
  };
  const failures = Object.entries(metrics)
    .filter(([, metric]) => !metric.passed)
    .map(([name, metric]) => `${name} p95 ${metric.p95Ms}ms > ${metric.budgetMs}ms`);
  const report = {
    result: failures.length ? "fail" : "pass",
    generatedAt: new Date().toISOString(),
    databaseSource: process.env.BAEUMZIP_TEST_DATABASE
      ? "canonical-fixture-clone"
      : "in-memory-migrations",
    qualityIssues: freshQualitySamples.at(-1)?.body.summary?.total ?? null,
    percentileMethod: "nearest-rank",
    metrics,
    failures,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = argumentValue("--output");
  if (outputPath) {
    const resolvedOutput = path.resolve(root, outputPath);
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(resolvedOutput, serialized, "utf8");
  }
  process.stdout.write(serialized);
  if (process.argv.includes("--enforce") && failures.length) process.exitCode = 1;
} finally {
  database.close();
}
