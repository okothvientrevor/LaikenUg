import { defineConfig } from "@neon/config/v1";

/**
 * Laiken Logistics backend on Neon.
 *  - auth: Managed Better Auth (staff sign-in for the dashboard)
 *  - functions.api: Hono API serving tracking, news, quotes and the staff endpoints
 *  - triggers.newsrefresh: cron that refreshes the URA / logistics news feed every 2 hours
 */
export default defineConfig({
  auth: true,
  functions: {
    api: {
      name: "Laiken Logistics API",
      source: "src/index.ts",
      env: {
        // Comma-separated list of browser origins allowed to call the API.
        ALLOWED_ORIGINS: {
          value:
            process.env.ALLOWED_ORIGINS ??
            "https://laikenug.com,https://www.laikenug.com,http://127.0.0.1:5500,http://localhost:5500",
          required: true,
        },
      },
    },
  },
  triggers: {
    newsrefresh: {
      type: "schedule",
      function: "api",
      cron: "15 */2 * * *",
      functionPath: "/cron/refresh-news",
    },
  },
});
