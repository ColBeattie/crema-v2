import type { MetadataRoute } from "next";

/**
 * Serves /robots.txt.
 *
 * Crawling is deliberately ALLOWED. The app is de-indexed via `noindex`
 * (the `robots` metadata in app/layout.tsx plus the `X-Robots-Tag` header in
 * next.config.ts), and a crawler has to be able to fetch a URL to see that
 * directive. Adding `Disallow: /` here would block the fetch and can leave
 * already-known URLs stranded in the index as bare, snippet-less links.
 *
 * A `Disallow` can be introduced later, once the URLs have dropped out of
 * search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
  };
}
