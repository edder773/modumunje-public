export const ADMIN_SECTIONS = [
  "dashboard",
  "members",
  "group-exams",
  "questions",
  "theories",
  "quality",
  "backups",
  "transfer",
  "analytics",
  "reports",
  "logs",
  "settings",
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];
