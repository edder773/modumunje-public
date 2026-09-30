export type CatalogFieldCard = {
  id: string;
  name: string;
  shortLabel: string;
  cardTitle: string;
  summary: string;
  href: string;
  offerings: string[];
  actionLabel: string;
  preparing?: boolean;
  links: { name: string; label: string; href: string; preparing?: boolean }[];
};

// Search only the cards supplied by the server; do not import the course registry.
export function searchCatalogFields(fields: CatalogFieldCard[], query: string): CatalogFieldCard[] {
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/정처기/gu, "정보처리");
  const terms = normalize(query).trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return fields;
  return fields.flatMap(field => {
    const links = field.links.filter(link => {
      const text = normalize(`${field.name} ${field.cardTitle} ${field.shortLabel} ${link.name} ${link.label}`).replace(/\s+/gu, "");
      return terms.every(term => text.includes(term));
    });
    return links.length ? [{ ...field, links }] : [];
  });
}

export const CATALOG_PAGE_SIZE = 12;

export function getCatalogPage(fields: CatalogFieldCard[], { query = "", fieldId = "", page = 1 } = {}) {
  const matches = searchCatalogFields(fields, query).filter(field => !fieldId || field.id === fieldId);
  const pageCount = Math.max(1, Math.ceil(matches.length / CATALOG_PAGE_SIZE));
  const currentPage = Math.max(1, Math.min(Number.isFinite(page) ? Math.floor(page) : 1, pageCount));
  return {
    fields: matches.slice((currentPage - 1) * CATALOG_PAGE_SIZE, currentPage * CATALOG_PAGE_SIZE),
    fieldCount: matches.length,
    courseCount: matches.reduce((sum, field) => sum + field.links.length, 0),
    currentPage,
    pageCount,
  };
}
