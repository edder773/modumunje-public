import layouts from "../../../../../fixtures/public/ipep-question-layouts.json";
import { normalizeMarkdownProse } from "@shared/content/content-format.mjs";

// Keep curated source text server-only. A changed question must never inherit
// an old presentation: match both its ID and complete normalized source prompt.
// Grading and editing continue to use the stored, fingerprinted source text.
const reviewed = new Map(layouts.map(layout => [layout.id, {
  sourcePrompt: normalizeMarkdownProse(layout.sourcePrompt),
  displayPrompt: normalizeMarkdownProse(`${layout.stem}\n\n${layout.details}`),
}]));

export function reviewedPracticalPrompt(id: number, prompt: string): string | undefined {
  const layout = reviewed.get(id);
  return layout && normalizeMarkdownProse(prompt) === layout.sourcePrompt
    ? layout.displayPrompt
    : undefined;
}
