import { expect, test } from "@playwright/test";
test.skip(!process.env.DEPLOYED_BASE_URL, "Operational API checks require a deployed D1 binding.");

const profileSubjects = [
  "data-structures",
  "operating-systems",
  "database-sql",
  "network-data-communication",
  "programming-languages",
  "software-engineering",
  "information-security",
  "system-operations",
].join(",");

function expectOperationalHeaders(headers: Record<string, string>) {
  expect(headers["x-request-id"]).toBeTruthy();
  expect(headers["server-timing"]).toMatch(/app;dur=/u);
}

test("cold and warm SW reads remain traceable without leaking private cache state", async ({ request }) => {
  const coldSummary = await request.get("/api/sw-study?view=summary");
  expect(coldSummary.status()).toBe(200);
  expectOperationalHeaders(coldSummary.headers());
  expect(coldSummary.headers()["x-baeumzip-content-version"]).toBeTruthy();
  expect(coldSummary.headers()["cache-control"]).toContain("public");

  const theories = await request.get("/api/sw-study?view=theories&subjects=data-structures");
  expect(theories.status()).toBe(200);
  expectOperationalHeaders(theories.headers());
  expect(theories.headers()["x-baeumzip-content-version"]).toBeTruthy();
  const theoriesPayload = await theories.json();
  expect(theoriesPayload.theories.length).toBeGreaterThan(0);

  const detail = await request.get(`/api/sw-study?view=theory&id=${theoriesPayload.theories[0].id}`);
  expect(detail.status()).toBe(200);
  expectOperationalHeaders(detail.headers());

  const profile = await request.get(
    `/api/sw-study?view=practice&profile=information-processing-engineer&limit=20&subjects=${profileSubjects}`,
  );
  expect(profile.status()).toBe(200);
  expectOperationalHeaders(profile.headers());
  expect(profile.headers()["x-baeumzip-content-version"]).toBeTruthy();
  expect(profile.headers()["cache-control"]).toContain("private, no-store");
  const profilePayload = await profile.json();
  expect(profilePayload.questions.length).toBeGreaterThan(0);
  expect(profilePayload.questions.every((question: { tags: string[] }) => question.tags.includes("정보처리기사"))).toBe(true);

  const warmResponses = await Promise.all(
    Array.from({ length: 10 }, () => request.get("/api/sw-study?view=summary")),
  );
  for (const response of warmResponses) {
    expect(response.status()).toBe(200);
    expectOperationalHeaders(response.headers());
  }
});

test("new SQL and SW practice sessions exclude the previous question batch", async ({ request }) => {
  const sqlFirst = await request.get("/api/study?scope=practice&exam=SQLD&kind=objective&limit=5");
  expect(sqlFirst.status()).toBe(200);
  const sqlFirstPayload = await sqlFirst.json();
  const sqlIds = sqlFirstPayload.questions.map((question: { id: number }) => question.id);
  expect(sqlIds.length).toBeGreaterThan(0);
  const sqlNext = await request.get(
    `/api/study?scope=practice&exam=SQLD&kind=objective&limit=5&exclude=${sqlIds.join(",")}`,
  );
  expect(sqlNext.status()).toBe(200);
  const sqlNextPayload = await sqlNext.json();
  expect(sqlNextPayload.questions.every((question: { id: number }) => !sqlIds.includes(question.id))).toBe(true);

  const swFirst = await request.get(
    `/api/sw-study?view=practice&profile=information-processing-engineer&limit=5&subjects=${profileSubjects}`,
  );
  expect(swFirst.status()).toBe(200);
  const swFirstPayload = await swFirst.json();
  const swIds = swFirstPayload.questions.map((question: { id: string }) => question.id);
  expect(swIds.length).toBeGreaterThan(0);
  const swNext = await request.get(
    `/api/sw-study?view=practice&profile=information-processing-engineer&limit=5&subjects=${profileSubjects}&exclude=${swIds.join(",")}`,
  );
  expect(swNext.status()).toBe(200);
  const swNextPayload = await swNext.json();
  expect(swNextPayload.questions.every((question: { id: string }) => !swIds.includes(question.id))).toBe(true);
});

test("health, invalid request, and missing resource envelopes are operationally distinct", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expectOperationalHeaders(health.headers());
  expect(health.headers()["cache-control"]).toContain("no-store");
  const payload = await health.json();
  expect(payload.status).toBe("ok");
  expect(payload.service).toBe("baeumzip");
  expect(payload.build).toBeUndefined();
  expect(payload.schema).toBeUndefined();
  expect(payload.database).toBeUndefined();
  expect(payload.contentRelease).toBeUndefined();

  const invalid = await request.get("/api/sw-study?view=unsupported");
  expect(invalid.status()).toBe(400);
  expectOperationalHeaders(invalid.headers());
  expect((await invalid.json()).code).toBe("SW_VIEW_UNSUPPORTED");

  const missing = await request.get("/api/sw-study?view=theory&id=999999999");
  expect(missing.status()).toBe(404);
  expectOperationalHeaders(missing.headers());
  expect((await missing.json()).code).toBe("SW_THEORY_NOT_FOUND");
});
