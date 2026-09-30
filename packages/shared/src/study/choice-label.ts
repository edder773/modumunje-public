const CHOICE_LABELS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

/** The stored answer remains a zero-based index; only its display label changes. */
export function choiceLabel(index: number): string {
  return CHOICE_LABELS[index] ?? String(index + 1);
}
