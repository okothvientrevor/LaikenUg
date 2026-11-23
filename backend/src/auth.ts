import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { MiddlewareHandler } from "hono";
import { one } from "./db";

/** Staff accounts must be @laikenug.com, with one named exception. */
export function isAllowedStaffEmail(email: string) {
  const e = email.trim().toLowerCase();
  return e.endsWith("@laikenug.com") || e === "vientrevor@gmail.com";
}

export type Staff = { email: string; name: string; role: "admin" | "agent"; userId: string };

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  if (!jwks) {
    const url = process.env.NEON_AUTH_JWKS_URL;
    if (!url) throw new Error("NEON_AUTH_JWKS_URL is not set (is auth: true deployed?)");
    jwks = createRemoteJWKSet(new URL(url));
  }
  return jwks;
}

type AuthPayload = JWTPayload & { email?: string; emailVerified?: boolean; name?: string };

/** Looks up email + verification for a user id when the JWT does not carry them. */
async function lookupUser(userId: string): Promise<{ email: string; emailVerified: boolean } | undefined> {
  try {
    return await one(`SELECT email, "emailVerified" AS "emailVerified" FROM neon_auth."user" WHERE id::text = $1`, [userId]);
  } catch {
    return undefined;
  }
}

/**
 * Resolves a Neon Auth *session token* (the opaque token returned by sign-in) by looking it up in the
 * neon_auth.session table on this branch. This lets the dashboard work in browsers that block the
 * sign-in service's cross-site cookie (Safari, Brave), where no JWT can be obtained.
 */
async function lookupSession(token: string): Promise<{ id: string; email: string; emailVerified: boolean } | undefined> {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) return undefined;
  return one(
    `SELECT u.id::text AS id, u.email, u."emailVerified" AS "emailVerified"
     FROM neon_auth.session s JOIN neon_auth."user" u ON u.id = s."userId"
     WHERE s.token = $1 AND s."expiresAt" > now() AND coalesce(u.banned, false) = false`,
    [token],
  );
}

/** Extracts the bearer credential from the request. */
export function bearer(c: { req: { header: (n: string) => string | undefined } }) {
  const header = c.req.header("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/**
 * Requires a signed-in user whose *verified* email is on the staff list. Accepts either a Neon Auth JWT
 * or a Neon Auth session token. Checking verification matters: otherwise anyone could sign up with a staff
 * address they don't own.
 */
export const requireStaff: MiddlewareHandler<{ Variables: { staff: Staff } }> = async (c, next) => {
  const credential = bearer(c);
  if (!credential) return c.json({ error: "Sign in required" }, 401);
  const expired = () => c.json({ error: "Your session has expired. Please sign in again." }, 401);

  let userId: string;
  let email: string | undefined;
  let verified: boolean | undefined;

  if (credential.split(".").length === 3) {
    let payload: AuthPayload;
    try {
      const issuer = new URL(process.env.NEON_AUTH_BASE_URL!).origin;
      ({ payload } = await jwtVerify<AuthPayload>(credential, getJwks(), { issuer }));
    } catch {
      return expired();
    }
    if (!payload.sub) return expired();
    userId = payload.sub;
    email = payload.email;
    verified = payload.emailVerified;
    if (!email || verified === undefined) {
      const user = await lookupUser(payload.sub);
      email ??= user?.email;
      verified ??= user?.emailVerified;
    }
  } else {
    const session = await lookupSession(credential);
    if (!session) return expired();
    ({ id: userId, email, emailVerified: verified } = session);
  }

  if (!email) return c.json({ error: "Sign in required" }, 401);
  if (!verified) {
    return c.json({ error: "Please verify your email address (sign in with an email code) before using the dashboard." }, 403);
  }

  if (!isAllowedStaffEmail(email)) {
    return c.json({ error: "Only @laikenug.com email addresses can use the staff dashboard.", email }, 403);
  }
  const staff = await one<Omit<Staff, "userId">>(`SELECT email, name, role FROM staff WHERE email = lower($1)`, [email]);
  if (!staff) return c.json({ error: "This account is not on the Laiken staff list. Ask an admin for access.", email }, 403);

  c.set("staff", { ...staff, userId });
  await next();
};
