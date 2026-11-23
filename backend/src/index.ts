import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { parseTriggerDelivery } from "@neon/functions/triggers";
import { one, pool, query } from "./db";
import { bearer, requireStaff, type Staff } from "./auth";
import { refreshNews } from "./news";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STATUSES = [
  "booked", "loaded_origin", "at_sea", "in_flight", "arrived_port", "customs_clearance", "released",
  "in_transit_road", "at_border", "arrived_kampala", "delivered", "on_hold",
] as const;
const MODES = ["sea", "air", "road", "rail"] as const;
const NEWS_CATEGORIES = ["ura", "ports", "eac", "transport", "trade"];

const SHIPMENT_FIELDS = [
  "client_name", "client_phone", "client_email", "mode", "origin", "destination", "port", "border",
  "container_no", "bl_awb_no", "house_bl_no", "cargo_desc", "packages", "weight_kg", "status", "current_location",
  "eta", "free_days_end", "assigned_to",
] as const;
type ShipmentField = (typeof SHIPMENT_FIELDS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

/** Tiny fixed-window rate limiter (per isolate — good enough to stop casual abuse). */
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(c: Context, bucket: string, limit: number, windowMs: number) {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return false;
  }
  entry.n += 1;
  return entry.n > limit;
}

const clean = (v: unknown, max = 300): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function normalizeShipment(body: Record<string, unknown>, partial: boolean) {
  const out: Partial<Record<ShipmentField, unknown>> = {};
  const errors: string[] = [];
  for (const f of SHIPMENT_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    switch (f) {
      case "mode":
        if (!MODES.includes(v as any)) errors.push("mode must be sea, air, road or rail");
        else out[f] = v;
        break;
      case "status":
        if (!STATUSES.includes(v as any)) errors.push("invalid status");
        else out[f] = v;
        break;
      case "packages":
        out[f] = v === "" || v == null ? null : Number.parseInt(String(v), 10) || null;
        break;
      case "weight_kg":
        out[f] = v === "" || v == null ? null : Number(v) || null;
        break;
      case "eta":
      case "free_days_end":
        if (v === "" || v == null) out[f] = null;
        else if (!isDate(v)) errors.push(`${f} must be YYYY-MM-DD`);
        else out[f] = v;
        break;
      case "container_no": {
        // "mscu 123456-7, tghu7654321" -> "MSCU1234567, TGHU7654321"
        const list = String(v ?? "").split(/[,;/\n]+/).map((x) => x.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean);
        out[f] = list.length ? list.join(", ") : null;
        break;
      }
      case "cargo_desc":
        out[f] = clean(v, 1000);
        break;
      default:
        out[f] = clean(v);
    }
  }
  if (!partial) {
    if (!out.client_name) errors.push("client_name is required");
    if (!out.mode) errors.push("mode is required");
    if (!out.origin) errors.push("origin is required");
  }
  return { data: out, errors };
}

/**
 * Tracking numbers look like LKL-26-K7Q4MX. The 6-character part is random (not sequential), so people
 * can't guess other clients' numbers on the public tracking page.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I lookalikes
async function nextTrackingNo(): Promise<string> {
  const yy = String(new Date().getUTCFullYear()).slice(2);
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    const candidate = `LKL-${yy}-${code}`;
    if (!(await one(`SELECT 1 FROM shipments WHERE tracking_no = $1`, [candidate]))) return candidate;
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Variables: { staff: Staff } }>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong on our side. Please try again." }, 500);
});

// The cron route is called by Neon (no Origin), so CORS applies only to browser routes.
app.use(
  "*",
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: ["authorization", "content-type"],
    maxAge: 86400,
  }),
);

app.get("/", (c) => c.json({ ok: true, service: "Laiken Logistics API" }));

// ---------------------------- Public ---------------------------------------

app.get("/track/:trackingNo", async (c) => {
  if (rateLimited(c, "track", 30, 60_000)) return c.json({ error: "Too many lookups. Please wait a minute." }, 429);
  // Clients may enter a Laiken tracking number, a B/L (master or house), an AWB, or any container number,
  // typed with or without spaces/dashes. Container numbers get reused, so the newest shipment wins.
  const key = c.req.param("trackingNo").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
  if (key.length < 4) return c.json({ error: "Please enter a full tracking, B/L, AWB or container number." }, 400);
  const s = await one(
    `SELECT id, tracking_no, mode, origin, destination, port, border, status, current_location, eta,
            packages, container_no, bl_awb_no, house_bl_no, updated_at, created_at,
            CASE WHEN lk_norm(tracking_no) = $1 THEN 'tracking'
                 WHEN lk_norm(house_bl_no) = $1 THEN CASE WHEN mode = 'air' THEN 'house_awb' ELSE 'house_bl' END
                 WHEN lk_norm(bl_awb_no) = $1 THEN CASE WHEN mode = 'air' THEN 'awb' ELSE 'bl' END
                 ELSE 'container' END AS matched_by
     FROM shipments
     WHERE lk_norm(tracking_no) = $1 OR lk_norm(bl_awb_no) = $1 OR lk_norm(house_bl_no) = $1
        OR $1 = ANY (lk_containers(container_no))
     ORDER BY (lk_norm(tracking_no) = $1) DESC, created_at DESC
     LIMIT 1`,
    [key],
  );
  if (!s) return c.json({ error: "We couldn't find a shipment with that number." }, 404);
  const events = await query(
    `SELECT status, location, note, created_at FROM shipment_events
     WHERE shipment_id = $1 AND is_public ORDER BY created_at DESC`,
    [s.id],
  );
  const { id: _id, container_no, ...rest } = s;
  const containers = String(container_no ?? "").split(/[,;/\n]+/).map((x) => x.trim()).filter(Boolean);
  return c.json({ shipment: { ...rest, containers }, events });
});

app.get("/news", async (c) => {
  const category = c.req.query("category");
  const q = clean(c.req.query("q"), 100);
  const limit = Math.min(Number(c.req.query("limit")) || 30, 100);
  const params: unknown[] = [];
  const where: string[] = [];
  if (category && NEWS_CATEGORIES.includes(category)) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(title ILIKE $${params.length} OR summary ILIKE $${params.length})`);
  }
  params.push(limit);
  const items = await query(
    `SELECT id, url, title, source, category, summary, image_url, published_at FROM news_items
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY published_at DESC LIMIT $${params.length}`,
    params,
  );
  const meta = await one<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'news_refreshed_at'`);
  c.header("Cache-Control", "public, max-age=120");
  return c.json({ items, refreshedAt: meta?.value ?? null });
});

app.post("/quotes", async (c) => {
  if (rateLimited(c, "quote", 5, 10 * 60_000)) return c.json({ error: "Too many requests. Please try again later." }, 429);
  const b = await c.req.json().catch(() => ({}));
  if (clean(b.website)) return c.json({ ok: true }); // honeypot field — bots fill it, people don't see it
  const name = clean(b.name, 120);
  const phone = clean(b.phone, 40);
  if (!name || !phone) return c.json({ error: "Name and phone number are required." }, 400);
  await pool.query(
    `INSERT INTO quote_requests (name, phone, email, mode, origin, cargo, message) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [name, phone, clean(b.email, 160), clean(b.mode, 20), clean(b.origin, 160), clean(b.cargo, 300), clean(b.message, 2000)],
  );
  return c.json({ ok: true }, 201);
});

// ---------------------------- Cron -----------------------------------------

app.post("/cron/refresh-news", async (c) => {
  const parsed = await parseTriggerDelivery(c.req.raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.error === "invalid_body" ? 400 : 401);
  return c.json({ ok: true, ...(await refreshNews()) });
});

// Ends the current session (works even when the browser blocks the sign-in cookie).
app.post("/signout", async (c) => {
  const token = bearer(c);
  if (/^[A-Za-z0-9_-]{20,200}$/.test(token)) await pool.query(`DELETE FROM neon_auth.session WHERE token = $1`, [token]);
  return c.json({ ok: true });
});

// ---------------------------- Staff ----------------------------------------

const staff = new Hono<{ Variables: { staff: Staff } }>();
staff.use("*", requireStaff);

staff.get("/me", (c) => c.json(c.get("staff")));

staff.get("/stats", async (c) => {
  const row = await one(`
    SELECT
      count(*) FILTER (WHERE status <> 'delivered')                                         AS active,
      count(*) FILTER (WHERE status IN ('arrived_port','customs_clearance'))                AS at_customs,
      count(*) FILTER (WHERE status IN ('released','in_transit_road','at_border'))          AS on_road,
      count(*) FILTER (WHERE status IN ('at_sea','in_flight','loaded_origin'))              AS in_transit_intl,
      count(*) FILTER (WHERE status = 'delivered' AND updated_at >= date_trunc('month', now())) AS delivered_month,
      count(*) FILTER (WHERE status <> 'delivered' AND eta < current_date)                  AS overdue,
      count(*) FILTER (WHERE status IN ('arrived_port','customs_clearance')
                         AND free_days_end IS NOT NULL AND free_days_end <= current_date + 3) AS free_days_alert,
      count(*) FILTER (WHERE status = 'on_hold')                                            AS on_hold
    FROM shipments`);
  const quotes = await one(`SELECT count(*) AS open_quotes FROM quote_requests WHERE NOT handled`);
  return c.json({ ...row, ...quotes });
});

staff.get("/shipments", async (c) => {
  const params: unknown[] = [];
  const where: string[] = [];
  const status = c.req.query("status");
  const mode = c.req.query("mode");
  const q = clean(c.req.query("q"), 100);
  const view = c.req.query("view"); // active | delivered | all
  if (status && STATUSES.includes(status as any)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  } else if (view !== "all") {
    where.push(view === "delivered" ? `status = 'delivered'` : `status <> 'delivered'`);
  }
  if (mode && MODES.includes(mode as any)) {
    params.push(mode);
    where.push(`mode = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(`(tracking_no ILIKE ${p} OR client_name ILIKE ${p} OR client_phone ILIKE ${p} OR container_no ILIKE ${p}
                 OR bl_awb_no ILIKE ${p} OR house_bl_no ILIKE ${p} OR cargo_desc ILIKE ${p} OR origin ILIKE ${p})`);
  }
  const rows = await query(
    `SELECT * FROM shipments ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY (status = 'delivered'), updated_at DESC LIMIT 300`,
    params,
  );
  return c.json({ shipments: rows });
});

staff.get("/shipments/:id", async (c) => {
  const s = await one(`SELECT * FROM shipments WHERE id = $1`, [Number(c.req.param("id"))]);
  if (!s) return c.json({ error: "Shipment not found" }, 404);
  const events = await query(`SELECT * FROM shipment_events WHERE shipment_id = $1 ORDER BY created_at DESC`, [s.id]);
  return c.json({ shipment: s, events });
});

staff.post("/shipments", async (c) => {
  const { data, errors } = normalizeShipment(await c.req.json().catch(() => ({})), false);
  if (errors.length) return c.json({ error: errors.join(", ") }, 400);
  const me = c.get("staff");
  data.status ??= "booked";
  const tracking = await nextTrackingNo();
  const cols = Object.keys(data);
  const s = await one(
    `INSERT INTO shipments (tracking_no, created_by, ${cols.join(", ")})
     VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(", ")}) RETURNING *`,
    [tracking, me.email, ...Object.values(data)],
  );
  await pool.query(
    `INSERT INTO shipment_events (shipment_id, status, location, note, is_public, created_by)
     VALUES ($1, $2, $3, 'Shipment booked with Laiken Logistics', true, $4)`,
    [s.id, s.status, s.current_location ?? s.origin, me.email],
  );
  return c.json({ shipment: s }, 201);
});

staff.patch("/shipments/:id", async (c) => {
  const { data, errors } = normalizeShipment(await c.req.json().catch(() => ({})), true);
  if (errors.length) return c.json({ error: errors.join(", ") }, 400);
  const cols = Object.keys(data);
  if (!cols.length) return c.json({ error: "Nothing to update" }, 400);
  const s = await one(
    `UPDATE shipments SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [Number(c.req.param("id")), ...Object.values(data)],
  );
  if (!s) return c.json({ error: "Shipment not found" }, 404);
  return c.json({ shipment: s });
});

staff.post("/shipments/:id/events", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!STATUSES.includes(b.status)) return c.json({ error: "Pick a valid status" }, 400);
  const me = c.get("staff");
  const id = Number(c.req.param("id"));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE shipments SET status = $2, current_location = COALESCE($3, current_location), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, b.status, clean(b.location)],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return c.json({ error: "Shipment not found" }, 404);
    }
    const ev = await client.query(
      `INSERT INTO shipment_events (shipment_id, status, location, note, is_public, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, b.status, clean(b.location) ?? rows[0].current_location, clean(b.note, 1000), b.is_public !== false, me.email],
    );
    await client.query("COMMIT");
    return c.json({ shipment: rows[0], event: ev.rows[0] }, 201);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

staff.get("/quotes", async (c) => {
  const rows = await query(`SELECT * FROM quote_requests ORDER BY handled, created_at DESC LIMIT 100`);
  return c.json({ quotes: rows });
});

staff.patch("/quotes/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const row = await one(`UPDATE quote_requests SET handled = $2 WHERE id = $1 RETURNING *`, [Number(c.req.param("id")), !!b.handled]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ quote: row });
});

// Any staff member can refresh the news from the dashboard; repeated clicks within 2 minutes are skipped.
staff.post("/news/refresh", async (c) => {
  const last = await one<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'news_refreshed_at'`);
  if (last && Date.now() - new Date(last.value).getTime() < 2 * 60_000) return c.json({ ok: true, skipped: true, inserted: 0 });
  return c.json({ ok: true, ...(await refreshNews()) });
});

app.route("/staff", staff);

export default app;
