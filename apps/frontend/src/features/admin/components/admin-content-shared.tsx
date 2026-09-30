"use client";

import Link from "next/link";
import { CONTENT_ADMIN_DOMAINS, type ContentAdminDomain } from "@shared/admin/content-domains";
export { contentDomainOptions, parseContentAdminDomain, type ContentAdminDomain, type CertificationAdminDomain } from "@shared/admin/content-domains";

export type SwAdminQuestion = {
  id: string;
  theoryId: number;
  theory_title?: string;
  subjectGroupId: string;
  subjectId: string;
  category: string;
  topic: string;
  displayOrder: number;
  difficulty: "하" | "중" | "상";
  difficultyRationale: string;
  kind: "single" | "multiple";
  prompt: string;
  choices: string[];
  correctAnswers: number[];
  explanation: string;
  tags: string[];
  requiredConcepts: string[];
  active: boolean;
};

export type SwAdminTheory = {
  id: number;
  subjectGroupId: string;
  subjectId: string;
  category: string;
  topic: string;
  title: string;
  summary: string;
  content: string;
  reviewAnswers: string;
  keywords: string[];
  sortOrder: number;
  active: boolean;
  linkedQuestions: number;
};

export type SwOptions = {
  theories: Array<{
    id: number;
    title: string;
    subject_group_id: string;
    subject_id: string;
    category: string;
    topic: string;
  }>;
};

export function ContentDomainTabs({ section, domain }: { section: "questions" | "theories"; domain: ContentAdminDomain }) {
  return (
    <nav className="admin-domain-tabs" aria-label="관리할 학습 분야">
      {CONTENT_ADMIN_DOMAINS.map(item => <Link key={item.id} aria-current={domain === item.id ? "page" : undefined} className={domain === item.id ? "active" : ""} href={`/admin/${section}?domain=${item.id}`}>{item.label}</Link>)}
    </nav>
  );
}

export function updateContentQuery(values: Record<string, string | number>) {
  const url = new URL(window.location.href);
  url.search = "";
  for (const [key, value] of Object.entries(values)) {
    if (String(value)) url.searchParams.set(key, String(value));
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
