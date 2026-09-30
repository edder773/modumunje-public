import { contentScopesForField, EXAM_SCOPE_OPTIONS, subjectsForField, type CourseFieldId } from '../study/study-domain';

export const CONTENT_ADMIN_DOMAINS = [
  { id: 'sql', fieldId: 'sql', label: 'SQL 자격증', shortLabel: 'SQL' },
  { id: 'da', fieldId: 'data-architecture', label: '데이터 아키텍처', shortLabel: 'DA' },
  { id: 'bae', fieldId: 'big-data-analysis', label: '빅데이터분석기사', shortLabel: '빅분기' },
  { id: 'ipe', fieldId: 'information-processing', label: '정보처리기사', shortLabel: '정보처리' },
  { id: 'ise', fieldId: 'information-security', label: '정보보안기사', shortLabel: '정보보안' },
  { id: 'sw', fieldId: 'software-major', label: 'SW 전공', shortLabel: 'SW' },
] as const;
export type ContentAdminDomain = typeof CONTENT_ADMIN_DOMAINS[number]['id'];
export type CertificationAdminDomain = Exclude<ContentAdminDomain, 'sw'>;
export function parseContentAdminDomain(value: unknown): ContentAdminDomain {
  return CONTENT_ADMIN_DOMAINS.find(domain => domain.id === value)?.id ?? 'sql';
}
export function contentDomainForLabel(value: unknown): ContentAdminDomain {
  return CONTENT_ADMIN_DOMAINS.find(domain => domain.shortLabel === value)?.id ?? 'sql';
}
export function certificationAdminField(value: unknown): CourseFieldId | null {
  const domain = CONTENT_ADMIN_DOMAINS.find(domain => domain.id === value);
  return domain && domain.id !== 'sw' ? domain.fieldId as CourseFieldId : null;
}
export function contentDomainForScope(scope: string): CertificationAdminDomain | undefined {
  return CONTENT_ADMIN_DOMAINS.find(domain => domain.id !== 'sw' && contentScopesForField(domain.fieldId as CourseFieldId).some(value => value === scope))?.id as CertificationAdminDomain | undefined;
}
export function contentDomainOptions(domain: CertificationAdminDomain) {
  const definition = CONTENT_ADMIN_DOMAINS.find(item => item.id === domain)!;
  const fieldId = definition.fieldId as CourseFieldId;
  const scopes = new Set(contentScopesForField(fieldId));
  return { fieldId, label: definition.shortLabel, scopeOptions: EXAM_SCOPE_OPTIONS.filter(option => scopes.has(option.value)), subjects: subjectsForField(fieldId) };
}
