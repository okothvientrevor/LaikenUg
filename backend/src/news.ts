import { XMLParser } from "fast-xml-parser";
import { pool } from "./db";

/**
 * News sources.
 * Google News search feeds give the best URA / port coverage, but Google's feed terms describe them as
 * "for personal, non-commercial use", and their links are Google redirects with no image (the site shows a
 * category photo for those). Set USE_GOOGLE_NEWS to false to rely only on publisher feeds.
 */
const USE_GOOGLE_NEWS = true;

const GOOGLE_QUERIES: { q: string; category: Category }[] = [
  { q: '"Uganda Revenue Authority" OR URA customs', category: "ura" },
  { q: "URA tax Uganda importers", category: "ura" },
  { q: "Mombasa port cargo Uganda", category: "ports" },
  { q: "Dar es Salaam port Uganda cargo", category: "ports" },
  { q: "EAC customs union Common External Tariff", category: "eac" },
  { q: "Northern Corridor Malaba Busia trucks", category: "transport" },
  { q: "Uganda logistics freight transport", category: "transport" },
  { q: "Uganda imports exports trade", category: "trade" },
];

// Publisher feeds. Only stories whose headline matches TOPIC_RE are kept.
const PUBLISHER_FEEDS = [
  { url: "https://www.independent.co.ug/feed/", source: "The Independent Uganda" },
  { url: "https://nilepost.co.ug/feed", source: "Nile Post" },
  { url: "https://observer.ug/feed/", source: "The Observer" },
  { url: "https://businessfocus.co.ug/feed/", source: "Business Focus" },
  { url: "https://softpower.ug/feed/", source: "SoftPower" },
  { url: "https://eagle.co.ug/feed/", source: "Eagle Online" },
  { url: "https://www.ceo.co.ug/feed/", source: "CEO East Africa" },
  { url: "https://dailyexpress.co.ug/feed/", source: "Daily Express" },
  { url: "https://capitalfm.africa/business/feed/", source: "Capital FM Business" },
];

export type Category = "ura" | "ports" | "eac" | "transport" | "trade";

// A publisher story is kept only when its *headline* is about trade, tax or transport.
const TOPIC_RE =
  /\b(URA|revenue authority|customs|tax(es|payers?)?|duty|duties|import(s|ers|ed)?|export(s|ers|ed)?|port|cargo|freight|logistics|shipping|container|truck(s|ers)?|transport(ers)?|SGR|railway|Malaba|Busia|Mutukula|Elegu|Mombasa|EAC|East African Community|tariff|trade|traders|fuel|EFRIS|ASYCUDA|clearing agents?)\b/i;

const CATEGORY_RULES: [Category, RegExp][] = [
  ["ura", /\b(URA|Uganda Revenue Authority|revenue authority|EFRIS|e-?tax|ASYCUDA|tax(es|payers?)?|duty|duties|customs)\b/i],
  ["ports", /\b(port|Mombasa|KPA|TPA|vessel|container|shipping|berth|ICD|Naivasha)\b/i],
  ["eac", /\b(EAC|East African Community|Common External Tariff|CET|customs union|COMESA|AfCFTA)\b/i],
  ["transport", /\b(truck(s|ers)?|transport(ers)?|roads?|SGR|railway|rail|Malaba|Busia|Mutukula|Elegu|border post|corridor|fuel|logistics|freight|air ?cargo)\b/i],
];

export function categorize(text: string, fallback: Category = "trade"): Category {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return fallback;
}

const UA = "Mozilla/5.0 (compatible; LaikenLogisticsNews/1.0; +https://laikenug.com)";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#038;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&#8217;/g, "'");
const stripHtml = (s: string) =>
  s.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&#039;|&#39;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&#8230;/g, "…").replace(/&#124;/g, "|").replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ").trim();

type Item = { url: string; title: string; source: string; category: Category; summary: string | null; image: string | null; published: Date };

const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const text = (x: any): string => (x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x));
const isGoogle = (url: string) => /^https:\/\/news\.google\.com\//.test(url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchFeed(url: string): Promise<any[]> {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const xml = parser.parse(await res.text());
  return asArray(xml?.rss?.channel?.item);
}

/** Image from the feed item itself: media:content / media:thumbnail / enclosure / first <img>. */
function feedImage(it: any): string | null {
  for (const key of ["media:content", "media:thumbnail", "enclosure"]) {
    for (const m of asArray(it[key])) {
      const url = m?.["@_url"];
      const type = String(m?.["@_type"] ?? m?.["@_medium"] ?? "");
      if (url && (!type || /image/i.test(type))) return decodeEntities(url);
    }
  }
  const html = text(it["content:encoded"]) + text(it.description);
  const src = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  return src ? decodeEntities(src) : null;
}

/** The article's share image (og:image / twitter:image), as used for link previews. */
async function pageImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 400_000);
    const m =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    return m ? new URL(decodeEntities(m[1]), url).href : null;
  } catch {
    return null;
  }
}

export async function googleItems(): Promise<Item[]> {
  const out: Item[] = [];
  for (const [n, { q, category }] of GOOGLE_QUERIES.entries()) {
    if (n) await sleep(2500); // Google rate-limits rapid-fire feed requests (HTTP 429)
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:14d")}&hl=en-UG&gl=UG&ceid=UG:en`;
    try {
      for (const it of (await fetchFeed(url)).slice(0, 15)) {
        const source = text(it.source) || "Google News";
        // Google titles end with " - Source".
        const title = stripHtml(text(it.title)).replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
        out.push({
          url: text(it.link),
          title,
          source,
          category: categorize(title, category),
          summary: null,
          image: null,
          published: new Date(text(it.pubDate) || Date.now()),
        });
      }
    } catch (err) {
      console.error("[news] google", q, err);
    }
  }
  return out;
}

export async function publisherItems(): Promise<Item[]> {
  const out: Item[] = [];
  await Promise.all(
    PUBLISHER_FEEDS.map(async (feed) => {
      try {
        for (const it of await fetchFeed(feed.url)) {
          const title = stripHtml(text(it.title));
          if (!TOPIC_RE.test(title)) continue;
          const summary = stripHtml(text(it.description)).replace(/The post .* appeared first on .*$/i, "").slice(0, 280);
          out.push({
            url: text(it.link).trim(),
            title,
            source: feed.source,
            category: categorize(title),
            summary: summary || null,
            image: feedImage(it),
            published: new Date(text(it.pubDate) || Date.now()),
          });
        }
      } catch (err) {
        console.error("[news] feed", feed.url, err);
      }
    }),
  );
  return out;
}

/** Runs fn over items with limited concurrency. */
async function eachLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** Fetches every source, stores new stories (with images), prunes old rows. Returns counts. */
export async function refreshNews() {
  const items = [...(USE_GOOGLE_NEWS ? await googleItems() : []), ...(await publisherItems())]
    .filter((i) => i.url && i.title && !Number.isNaN(i.published.getTime()));

  // Dedupe by URL and by near-identical title (the same story appears under several queries).
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const key = i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
    if (seen.has(i.url) || seen.has(key)) return false;
    seen.add(i.url).add(key);
    return true;
  });

  // Only new stories need work.
  const { rows: existing } = await pool.query(`SELECT url FROM news_items WHERE url = ANY($1)`, [unique.map((i) => i.url)]);
  const known = new Set(existing.map((r) => r.url));
  const fresh = unique.filter((i) => !known.has(i.url));

  // Publisher stories without a feed image: read the article's share image.
  await eachLimit(fresh.filter((i) => !i.image && !isGoogle(i.url)), 4, async (i) => {
    i.image = await pageImage(i.url);
  });

  let inserted = 0;
  for (const i of fresh) {
    const r = await pool.query(
      `INSERT INTO news_items (url, title, source, category, summary, image_url, published_at, image_checked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (url) DO NOTHING`,
      [i.url, i.title.slice(0, 400), i.source, i.category, i.summary, i.image, i.published],
    );
    inserted += r.rowCount ?? 0;
  }

  const imagesBackfilled = await backfillImages(25);

  await pool.query(`DELETE FROM news_items WHERE published_at < now() - interval '60 days'`);
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ('news_refreshed_at', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [new Date().toISOString()],
  );
  return { fetched: items.length, unique: unique.length, inserted, imagesBackfilled };
}

/** Tries once to find an image for older publisher stories saved without one. */
export async function backfillImages(limit: number) {
  const { rows } = await pool.query(
    `SELECT id, url FROM news_items
     WHERE image_url IS NULL AND NOT image_checked AND url NOT LIKE 'https://news.google.com/%'
     ORDER BY published_at DESC LIMIT $1`,
    [limit],
  );
  let found = 0;
  await eachLimit(rows, 4, async (row) => {
    const image = await pageImage(row.url);
    if (image) found++;
    await pool.query(`UPDATE news_items SET image_url = $2, image_checked = true WHERE id = $1`, [row.id, image]);
  });
  return found;
}
