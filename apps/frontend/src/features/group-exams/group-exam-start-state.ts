// One-use handoff of the authenticated start response; never durable exam authority.
const starts = new Map<string, Record<string, unknown>>();
export function seedGroupExam(runId: string, current: Record<string, unknown>) { starts.set(runId, current); }
export function takeGroupExamStart(runId: string) { const current = starts.get(runId); starts.delete(runId); return current; }
