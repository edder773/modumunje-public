const PREFIX = "@ipep-fields-v1:";

export function decodePracticalFields(value: string): string[] | null {
  if (!value.startsWith(PREFIX)) return null;
  try {
    const fields: unknown = JSON.parse(value.slice(PREFIX.length));
    return Array.isArray(fields) && fields.length <= 32 && fields.every(item => typeof item === "string") ? fields : null;
  } catch { return null; }
}

export function encodePracticalFields(fields: string[]): string {
  return fields.some(value => value.trim()) ? PREFIX + JSON.stringify(fields) : "";
}

export function hasPracticalAnswer(value: string): boolean {
  return value.startsWith(PREFIX) ? Boolean(decodePracticalFields(value)?.some(item => item.trim())) : Boolean(value.trim());
}
