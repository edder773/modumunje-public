import { requestJson } from "@frontend/shared/api/request-json";

type UserReport = {
  category: string;
  title: string;
  description: string;
  questionId?: number;
};

export async function submitUserReport(report: UserReport) {
  const payload = await requestJson<{ report?: { id?: unknown; status?: unknown; createdAt?: unknown } }>(
    "/api/reports",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sql-study-user-request": "1" },
      body: JSON.stringify(report),
    },
    {
      maxAttempts: 1,
      attemptTimeoutMs: 10_000,
      totalBudgetMs: 10_000,
      failureMessage: "제보 접수 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
      invalidResponseMessage: "제보 접수 결과를 확인할 수 없는 응답입니다. 잠시 후 다시 확인해 주세요.",
    },
  );
  if (!payload.report || typeof payload.report.id !== "string" || !payload.report.id.trim()
    || payload.report.status !== "new" || typeof payload.report.createdAt !== "string"
    || !Number.isFinite(Date.parse(payload.report.createdAt))) {
    throw new Error("제보 접수 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.");
  }
  return payload.report;
}
