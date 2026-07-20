import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repository lives beside other apps in the local workspace. Pinning
  // the Turbopack root prevents builds from scanning the entire home workspace
  // after detecting its unrelated top-level package-lock.json.
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      // IA renames — old bookmarks keep working
      { source: '/marketing', destination: '/acquisition', permanent: true },
      { source: '/churn', destination: '/customers', permanent: true },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "curious-minds-software",
  project: "chunk-analytics",

  // Source map upload auth token
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload wider set of client source files for better stack traces
  widenClientFileUpload: true,

  // Route browser requests through Next.js to bypass ad-blockers
  tunnelRoute: "/monitoring",

  // Suppress build output outside CI
  silent: !process.env.CI,
});
