import { APP_SITE_URL, appPath } from "@/lib/app-path";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = APP_SITE_URL;
  return {
    rules: [
      {
        userAgent: "*",
        // The card route stays crawlable: Twitterbot honours robots.txt, and
        // blocking it would strip the image off every shared plan's unfurl.
        allow: [appPath("/"), appPath("/api/community/plans/*/card")],
        // JSON endpoints and dataset shards have no place in an index.
        disallow: [appPath("/api/"), appPath("/datasets/")],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
