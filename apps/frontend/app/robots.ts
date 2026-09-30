import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Learning documents must remain crawlable so engines can observe their
      // noindex directive. robots.txt alone cannot prevent URL-only indexing.
      disallow: [
        "/admin",
        "/api/",
      ],
    },
    sitemap: ["https://modumunje.com/sitemap.xml", "https://modumunje.com/theory-sitemap.xml"],
    host: "https://modumunje.com",
  };
}
