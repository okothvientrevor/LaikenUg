// Gives a person access to the staff dashboard.
// Usage: npm run staff:add -- someone@laikenug.com "Full Name" [admin|agent]
import "dotenv/config";
import pg from "pg";
import { execFileSync } from "node:child_process";

const [email, name, role = "agent"] = process.argv.slice(2);
if (!email || !name || !["admin", "agent"].includes(role)) {
  console.error('Usage: npm run staff:add -- <email> "<name>" [admin|agent]');
  process.exit(1);
}

const e = email.trim().toLowerCase();
if (!(e.endsWith("@laikenug.com") || e === "vientrevor@gmail.com")) {
  console.error("Only @laikenug.com addresses (or vientrevor@gmail.com) can be staff.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(
    `INSERT INTO staff (email, name, role) VALUES (lower($1), $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role`,
    [email, name, role],
  );
  // Public sign-up is disabled (so codes are never sent to unknown addresses), so create the sign-in account here.
  const { rows } = await client.query(`SELECT 1 FROM neon_auth."user" WHERE lower(email) = $1`, [e]);
  if (!rows.length) {
    execFileSync("neon", ["neon-auth", "user", "create", "--email", e, "--name", name], { stdio: ["ignore", "ignore", "inherit"] });
    console.log(`Created a sign-in account for ${e}.`);
  }
  console.log(`${email} can now sign in to the dashboard as ${role}.`);
} finally {
  await client.end();
}
