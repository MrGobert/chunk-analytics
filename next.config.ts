import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
