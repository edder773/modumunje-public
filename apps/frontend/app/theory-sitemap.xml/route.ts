import { parseUtcDate } from "@shared/date/korea-date.mjs";
import { readPublicTheorySitemapEntries } from "@backend/modules/study/public-theory.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const paths = await readPublicTheorySitemapEntries();
  const escapeXml = (value: string) => value.replace(/[<>&"']/gu, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
  const urls = paths.map(({path, updatedAt}) => {
    const modified = updatedAt ? parseUtcDate(updatedAt) : null;
    const lastmod = modified && Number.isFinite(modified.getTime()) ? `<lastmod>${modified.toISOString()}</lastmod>` : "";
    return `<url><loc>${escapeXml(`https://modumunje.com${path}`)}</loc>${lastmod}</url>`;
  }).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
