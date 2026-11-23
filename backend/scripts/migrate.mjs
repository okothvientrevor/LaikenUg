// Applies db/schema.sql (and db/seed.sql with --seed) to the branch in .env.
// Usage: npm run db:migrate   |   npm run db:seed
import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run `neon env pull` in backend/ first.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const files = ["db/schema.sql", ...(process.argv.includes("--seed") ? ["db/seed.sql"] : [])];
  for (const file of files) {
    const sql = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    await client.query(sql);
    console.log(`Applied ${file}`);
  }
} finally {
  await client.end();
}
