import { examType, numberList, type JsonRecord } from "./study-request-values";

// Only fields that affect the import are bound to its receipt. Attempt order is
// significant because it determines the stable client operation IDs.
export async function guestImportPayloadDigest(payload: JsonRecord): Promise<string> {
  const bookmarks = [...new Set(numberList(payload.bookmarks))].filter(id => id > 0).sort((a,b) => a-b);
  const attempts = (Array.isArray(payload.attempts) ? payload.attempts : []).map(value => {
    const item = value as JsonRecord;
    const date = typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt))
      ? item.createdAt : null;
    return {
      questionId: Number(item.questionId),
      selectedAnswers: [...new Set(numberList(item.selectedAnswers))].sort((a,b) => a-b),
      answerText: typeof item.answerText === "string" ? item.answerText.slice(0, 16_384) : "",
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      mode: String(item.mode ?? "practice").slice(0, 60),
      examType: examType(item.examType),
      createdAt: date,
    };
  });
  const material = JSON.stringify({ selectedExam: examType(payload.selectedExam), bookmarks, attempts });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
