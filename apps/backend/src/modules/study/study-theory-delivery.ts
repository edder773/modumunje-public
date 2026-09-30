import { uniqueStrings } from "./domain/study.domain";

function navigationTheory(context: Record<string, unknown>, prefix: "previous" | "next") {
  const id = Number(context[`${prefix}Id`]);
  if (!Number.isInteger(id) || id < 1) return null;
  return {
    id,
    title: String(context[`${prefix}Title`] ?? ""),
    category: String(context[`${prefix}Category`] ?? ""),
    topic: String(context[`${prefix}Topic`] ?? ""),
    sortOrder: Number(context[`${prefix}SortOrder`] ?? 0),
    examScope: String(context[`${prefix}ExamScope`] ?? "both"),
    summary: String(context[`${prefix}Summary`] ?? ""),
    keywords: uniqueStrings(context[`${prefix}Keywords`]),
    content: "",
    reviewAnswers: "",
  };
}

export function theoryDetailDelivery(context: Record<string, unknown>) {
  return {
    row: {
      id: Number(context.id),
      title: String(context.title ?? ""),
      category: String(context.category ?? ""),
      topic: String(context.topic ?? ""),
      sortOrder: Number(context.sortOrder ?? 0),
      examScope: String(context.examScope ?? "both"),
      difficulty: String(context.difficulty ?? "foundation"),
      active: Boolean(context.active),
      summary: String(context.summary ?? ""),
      content: String(context.content ?? ""),
      reviewAnswers: String(context.reviewAnswers ?? ""),
      keywords: String(context.keywords ?? "[]"),
      createdAt: String(context.createdAt ?? ""),
      updatedAt: String(context.updatedAt ?? ""),
    },
    linkedCount: Number(context.linkedCount ?? 0),
    previous: navigationTheory(context, "previous"),
    next: navigationTheory(context, "next"),
  };
}
