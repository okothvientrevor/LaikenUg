/* logistics-tracker.html — staff dashboard (ES module) */
const LK = window.LK;
const cfg = LK.config;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = LK.esc;

// =====================================================================
// Auth (Neon Managed Auth via @neon/auth, loaded from the CDN)
// =====================================================================
let authClient = null;
async function getAuth() {
  if (authClient) return authClient;
  if (!cfg.AUTH_URL) throw new Error("AUTH_URL is missing in js/logistics-config.js");
  const mod = await import("https://cdn.jsdelivr.net/npm/@neon/auth@0.8.2/+esm");
  authClient = mod.createAuthClient(cfg.AUTH_URL);
  return authClient;
}

let cachedToken = null;
let tokenExpires = 0;
const isJwt = (t) => typeof t === "string" && t.split(".").length === 3;
function jwtExpiry(t) {
  try {
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch { return 0; }
}

/**
 * Neon Auth delivers the API token (a JWT) with the session: getSession() puts it in data.session.token
 * (from the `set-auth-jwt` response header). Note: auth.token() is answered from the SDK's session cache,
 * so it can't be relied on; it is only a fallback, forced to hit the server.
 */
// The session token returned at sign-in, kept in this browser so the dashboard works even when the
// browser blocks the sign-in service's cross-site cookie (Safari, Brave). The API checks it server-side.
const SESSION_KEY = "lk_staff_session";
function storedSession() { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } }
function storeSession(t) { try { t ? localStorage.setItem(SESSION_KEY, t) : localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ } }

async function getToken() {
  if (LK.demo) return null;
  const stored = storedSession();
  if (stored) return stored;
  if (cachedToken && Date.now() < tokenExpires) return cachedToken;
  const auth = await getAuth();
  let token = null;
  try {
    const { data } = await auth.getSession();
    token = data?.session?.token;
  } catch (e) { console.warn("getSession failed", e); }
  if (!isJwt(token) && typeof auth.token === "function") {
    try {
      const res = await auth.token({ fetchOptions: { headers: { "X-Force-Fetch": "1" } } });
      token = res?.data?.token ?? res?.data?.session?.token;
    } catch (e) { console.warn("token() failed", e); }
  }
  if (!isJwt(token)) {
    const err = new Error("Your session has expired. Please sign in again.");
    err.status = 401;
    throw err;
  }
  cachedToken = token;
  const exp = jwtExpiry(token);
  tokenExpires = exp ? exp - 60_000 : Date.now() + 5 * 60_000; // refresh a minute before it expires
  return token;
}

async function api(path, opts = {}) {
  try {
    return await LK.api(path, { ...opts, token: await getToken() });
  } catch (err) {
    if (err.status === 401 && !LK.demo) {
      cachedToken = null;
      storeSession(null);
      showLogin("Your session has expired. Please sign in again.");
    }
    throw err;
  }
}

/** Only @laikenug.com addresses (plus vientrevor@gmail.com) can be staff. The server enforces this too. */
const STAFF_EMAIL_HINT = "Only @laikenug.com email addresses can sign in to the staff dashboard.";
function isAllowedStaffEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return e.endsWith("@laikenug.com") || e === "vientrevor@gmail.com";
}

function errMsg(e) {
  return e?.message || e?.error?.message || (typeof e === "string" ? e : "Something went wrong");
}

// =====================================================================
// Views
// =====================================================================
function show(view) {
  $("#bootView").hidden = view !== "boot";
  $("#loginView").hidden = view !== "login";
  $("#appView").hidden = view !== "app";
}

function loginPanel(which) {
  for (const id of ["loginDemo", "otpForm", "pwForm", "noAccess"]) $("#" + id).hidden = id !== which;
}

function showLogin(message) {
  stopAutoRefresh();
  show("login");
  if (LK.demo) return loginPanel("loginDemo");
  loginPanel("otpForm");
  resetOtp();
  if (message) alertBox("#loginAlert", "info", message);
}

function alertBox(sel, kind, msg) {
  const el = $(sel);
  el.className = "lk-alert show " + kind;
  el.textContent = msg;
}
function clearAlert(sel) { $(sel).className = "lk-alert"; }

let toastTimer;
function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "lk-toast show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "lk-toast"), 3500);
}

// ---------------------------------------------------------------- OTP login
let otpEmail = "";
function resetOtp() {
  otpEmail = "";
  $("#emailField").hidden = false;
  $("#codeField").hidden = true;
  $("#otpBack").hidden = true;
  $("#otpSub").textContent = "We'll email you a one-time sign-in code. Use your @laikenug.com address.";
  $("#otpBtn").innerHTML = '<i class="fa fa-envelope"></i> Email me a code';
  $("#loginCode").value = "";
  clearAlert("#loginAlert");
}

$("#otpForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#otpBtn");
  btn.disabled = true;
  clearAlert("#loginAlert");
  try {
    const auth = await getAuth();
    if (!otpEmail) {
      const email = $("#loginEmail").value.trim().toLowerCase();
      if (!email) throw new Error("Enter your work email.");
      if (!isAllowedStaffEmail(email)) throw new Error(STAFF_EMAIL_HINT);
      const { error } = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (error) throw error;
      otpEmail = email;
      $("#emailField").hidden = true;
      $("#codeField").hidden = false;
      $("#otpBack").hidden = false;
      $("#otpSub").innerHTML = "We sent a 6-digit code to <b>" + esc(email) + "</b>. It may take a minute to arrive.";
      btn.innerHTML = '<i class="fa fa-check"></i> Verify and sign in';
      $("#loginCode").focus();
    } else {
      const otp = $("#loginCode").value.replace(/\D/g, "");
      if (otp.length < 6) throw new Error("Enter the 6-digit code from your email.");
      const { data, error } = await auth.signIn.emailOtp({ email: otpEmail, otp });
      if (error) throw error;
      storeSession(data?.token || null);
      await enterApp(true);
    }
  } catch (err) {
    alertBox("#loginAlert", "err", errMsg(err));
  } finally {
    btn.disabled = false;
  }
});
$("#otpBack").addEventListener("click", resetOtp);
$("#toPassword").addEventListener("click", () => { loginPanel("pwForm"); $("#pwEmail").value = $("#loginEmail").value; });
$("#toOtp").addEventListener("click", () => { loginPanel("otpForm"); resetOtp(); });

$("#pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert("#pwAlert");
  const btn = $("#pwForm [type=submit]");
  btn.disabled = true;
  try {
    const auth = await getAuth();
    if (!isAllowedStaffEmail($("#pwEmail").value)) throw new Error(STAFF_EMAIL_HINT);
    const { data, error } = await auth.signIn.email({ email: $("#pwEmail").value.trim(), password: $("#pwPass").value });
    if (error) throw error;
    storeSession(data?.token || null);
    await enterApp(true);
  } catch (err) {
    alertBox("#pwAlert", "err", errMsg(err));
  } finally {
    btn.disabled = false;
  }
});

async function signOut() {
  if (!LK.demo) {
    try { await LK.api("/signout", { method: "POST", token: await getToken() }); } catch { /* already signed out */ }
    try { await (await getAuth()).signOut(); } catch { /* cookie may be blocked; the session was ended above */ }
  }
  cachedToken = null;
  storeSession(null);
  showLogin();
}
$("#signOutBtn").addEventListener("click", signOut);
$("#noAccessOut").addEventListener("click", signOut);
$("#enterDemo").addEventListener("click", () => enterApp());

// =====================================================================
// Boot
// =====================================================================
let me = null;

async function enterApp(justSignedIn = false) {
  show("boot");
  try {
    me = await api("/staff/me");
  } catch (err) {
    if (err.status === 403) {
      show("login");
      loginPanel("noAccess");
      $("#noAccessMsg").textContent = err.message;
      return;
    }
    if (err.status === 401 && justSignedIn) {
      // Sign-in worked but no session came back: almost always the browser blocking the sign-in cookie.
      showLogin();
      alertBox("#loginAlert", "err", "You signed in, but your browser didn't keep the session. If you use Safari, Brave or a private window, allow cookies for this site (or try Chrome), then sign in again.");
      return;
    }
    if (err.status !== 401) { show("login"); loginPanel("otpForm"); alertBox("#loginAlert", "err", errMsg(err)); }
    return;
  }
  $("#userName").textContent = me.name;
  $("#userRole").textContent = me.role === "admin" ? "Admin" : "Agent";
  $("#avatar").textContent = (me.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const h = new Date().getHours();
  $("#greeting").textContent = (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening") + ", " + me.name.split(" ")[0];
  $("#today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  show("app");
  initMap();
  await refreshAll();
  loadNews();
  startAutoRefresh();
}


// =====================================================================
// Data + rendering
// =====================================================================
const state = { view: "active", q: "", mode: "", status: "", kpi: "", shipments: [] };

const KPI_DEFS = [
  { key: "active", label: "Active shipments", icon: "fa-cubes", bg: "#e0f6f9", fg: "#0a7387", filter: { view: "active" } },
  { key: "at_customs", label: "At port / customs", icon: "fa-file-text-o", bg: "#fff2d6", fg: "#9a6400", filter: { kpi: "customs" } },
  { key: "on_road", label: "On the road", icon: "fa-truck", bg: "#ebe9ff", fg: "#4b3cc0", filter: { kpi: "road" } },
  { key: "in_transit_intl", label: "At sea / in flight", icon: "fa-ship", bg: "#e4efff", fg: "#1f55b5", filter: { kpi: "intl" } },
  { key: "overdue", label: "Past ETA", icon: "fa-clock-o", bg: "#fde6e6", fg: "#b42828", warn: true, filter: { kpi: "overdue" } },
  { key: "free_days_alert", label: "Free days ending ≤3d", icon: "fa-hourglass-half", bg: "#ffe8dc", fg: "#b34812", warn: true, filter: { kpi: "freedays" } },
];
const KPI_FILTERS = {
  customs: { label: "At port / customs", test: (s) => ["arrived_port", "customs_clearance"].includes(s.status) },
  road: { label: "On the road", test: (s) => ["released", "in_transit_road", "at_border"].includes(s.status) },
  intl: { label: "At sea / in flight", test: (s) => ["at_sea", "in_flight", "loaded_origin"].includes(s.status) },
  overdue: { label: "Past ETA", test: (s) => s.status !== "delivered" && s.eta && LK.daysUntil(s.eta) < 0 },
  freedays: { label: "Free days ending soon", test: (s) => freeDaysWarn(s) },
};
function freeDaysWarn(s) {
  return ["arrived_port", "customs_clearance"].includes(s.status) && s.free_days_end && LK.daysUntil(s.free_days_end) <= 3;
}

function renderKpis(stats) {
  $("#kpis").innerHTML = KPI_DEFS.map((k) => {
    const n = Number(stats[k.key] || 0);
    const active = (k.filter.kpi && state.kpi === k.filter.kpi) || (!k.filter.kpi && !state.kpi && state.view === "active" && k.key === "active");
    return `<button class="tk-kpi${k.warn && n > 0 ? " warn" : ""}${active ? " is-active" : ""}" data-kpi="${k.filter.kpi || ""}">
      <div class="ic" style="background:${k.bg};color:${k.fg}"><i class="fa ${k.icon}"></i></div>
      <b>${n}</b><span>${k.label}</span></button>`;
  }).join("");
  $("#quoteCount").textContent = stats.open_quotes ? stats.open_quotes + " open" : "";
}
$("#kpis").addEventListener("click", (e) => {
  const b = e.target.closest(".tk-kpi");
  if (!b) return;
  const k = b.getAttribute("data-kpi");
  state.kpi = state.kpi === k ? "" : k;
  if (state.kpi) setView("active", false);
  loadShipments();
  loadStats();
});

function shipmentsQuery() {
  const p = new URLSearchParams({ view: state.view });
  if (state.q) p.set("q", state.q);
  if (state.mode) p.set("mode", state.mode);
  if (state.status) p.set("status", state.status);
  return "/staff/shipments?" + p.toString();
}

function renderRows(flashId) {
  let list = state.shipments;
  if (state.kpi) list = list.filter(KPI_FILTERS[state.kpi].test);
  $("#count").textContent = "(" + list.length + ")";
  $("#activeFilter").innerHTML = state.kpi
    ? `<span class="tk-filter-tag">${esc(KPI_FILTERS[state.kpi].label)} <button aria-label="Clear filter" data-clear-kpi><i class="fa fa-times"></i></button></span>`
    : "";
  if (!list.length) {
    $("#rows").innerHTML = `<tr><td colspan="5"><div class="lk-empty" style="border:0"><i class="fa fa-inbox"></i>No shipments match.
      ${state.q || state.kpi || state.mode || state.status ? "Try clearing the filters." : '<br><button class="lk-btn lk-btn-teal lk-btn-sm" style="margin-top:12px" data-new>Add the first shipment</button>'}</div></td></tr>`;
    return;
  }
  $("#rows").innerHTML = list.map((s) => {
    const mode = LK.MODE[s.mode] || LK.MODE.sea;
    const d = LK.daysUntil(s.eta);
    const etaCls = s.status === "delivered" ? "" : d !== null && d < 0 ? "late" : d !== null && d <= 2 ? "soon" : "";
    const fd = freeDaysWarn(s) ? `<div class="tk-badge-warn"><i class="fa fa-hourglass-half"></i> Free days ${LK.daysUntil(s.free_days_end) < 0 ? "ended" : "end " + LK.etaText(s.free_days_end).toLowerCase()}</div>` : "";
    return `<tr data-id="${s.id}" class="${flashId === s.id ? "flash" : ""}">
      <td class="c-no"><div class="tk-no">${esc(s.tracking_no)}</div><div class="tk-sub">${esc(s.client_name)}</div></td>
      <td class="c-route"><div class="tk-route"><span class="tk-mode" title="${mode.label}"><i class="fa ${mode.icon}"></i></span>
        <div><div>${esc(s.origin)} <i class="fa fa-long-arrow-right" style="color:var(--lk-muted)"></i> ${esc(s.destination)}</div>
        <div class="tk-sub">${esc([s.container_no, s.cargo_desc].filter(Boolean).join(" · "))}</div></div></div></td>
      <td class="c-status">${LK.chip(s.status)}<div class="tk-sub" style="margin-top:4px"><i class="fa fa-map-marker"></i> ${esc(s.current_location || "—")}</div>${fd}</td>
      <td class="c-eta"><div class="tk-eta ${etaCls}">${s.status === "delivered" ? "Delivered" : LK.etaText(s.eta, s.status)}</div><div class="tk-sub">${LK.fmtDate(s.eta)}</div></td>
      <td class="c-upd tk-sub">${LK.timeAgo(s.updated_at)}</td></tr>`;
  }).join("");
}

$("#rows").addEventListener("click", (e) => {
  if (e.target.closest("[data-new]")) return openNew();
  const tr = e.target.closest("tr[data-id]");
  if (tr) openDrawer(Number(tr.getAttribute("data-id")));
});
$("#activeFilter").addEventListener("click", (e) => {
  if (e.target.closest("[data-clear-kpi]")) { state.kpi = ""; renderRows(); loadStats(); }
});

async function loadStats() {
  try { renderKpis(await api("/staff/stats")); } catch (e) { console.error(e); }
}
async function loadShipments(flashId) {
  try {
    const { shipments } = await api(shipmentsQuery());
    state.shipments = shipments;
    renderRows(flashId);
    if (state.view !== "delivered") renderMap(shipments.filter((s) => s.status !== "delivered"));
  } catch (e) {
    if (e.status !== 401) $("#rows").innerHTML = `<tr><td colspan="5"><div class="lk-alert err show">${esc(e.message)}</div></td></tr>`;
  }
}
async function loadQuotes() {
  try {
    const { quotes } = await api("/staff/quotes");
    const open = quotes.filter((q) => !q.handled);
    $("#quotes").innerHTML = open.length
      ? open.slice(0, 8).map((q) => {
          const phone = (q.phone || "").replace(/\D/g, "").replace(/^0/, "256");
          return `<li class="tk-quote"><b>${esc(q.name)}</b> <span class="tk-sub">· ${LK.timeAgo(q.created_at)}</span>
            <div class="tk-sub">${esc([q.mode, q.origin, q.cargo].filter(Boolean).join(" · "))}</div>
            ${q.message ? `<div style="font-size:13.5px;margin-top:4px">${esc(q.message)}</div>` : ""}
            <div class="acts">
              <a class="lk-btn lk-btn-wa lk-btn-sm" target="_blank" rel="noopener" href="https://wa.me/${phone}?text=${encodeURIComponent("Hello " + q.name.split(" ")[0] + ", this is Laiken Logistics following up on your quote request.")}"><i class="fa fa-whatsapp"></i> ${esc(q.phone)}</a>
              <button class="lk-btn lk-btn-light lk-btn-sm" data-handle="${q.id}"><i class="fa fa-check"></i> Done</button>
            </div></li>`;
        }).join("")
      : '<li class="tk-sub" style="text-align:center;padding:22px">No open quote requests 🎉</li>';
  } catch (e) { console.error(e); }
}
$("#quotes").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-handle]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("/staff/quotes/" + b.getAttribute("data-handle"), { method: "PATCH", body: { handled: true } });
    toast("Quote marked as handled");
    loadQuotes(); loadStats();
  } catch (err) { toast(err.message, true); b.disabled = false; }
});

let seenNews = null; // URLs shown before the last refresh, so new stories can be highlighted

async function loadNews(highlightNew = false) {
  try {
    // Cache-buster: the public /news response is cacheable, but the dashboard always wants the latest.
    const { items, refreshedAt } = await LK.api("/news?limit=12&_=" + Date.now());
    const latest = items.slice(0, 8); // newest first
    const before = seenNews;
    seenNews = new Set(items.map((n) => n.url));
    $("#newsStatus").textContent = refreshedAt ? "Feed updated " + LK.timeAgo(refreshedAt) + " · refreshes automatically every 2 hours" : "Waiting for the first news refresh";
    $("#news").innerHTML = latest.length
      ? latest.map((n) => {
          const c = LK.NEWS_CATS[n.category] || LK.NEWS_CATS.trade;
          const isNew = highlightNew && before && !before.has(n.url);
          return `<li class="${isNew ? "is-new" : ""}"><a class="title" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
            <div class="meta">${isNew ? '<span class="tk-new">NEW</span>' : ""}<span class="lk-cat ${esc(n.category)}">${c.label}</span>${esc(n.source || "")} · ${LK.timeAgo(n.published_at)}</div></li>`;
        }).join("")
      : `<li class="tk-sub" style="text-align:center;padding:22px">${LK.demo ? "Live news appears here once the backend is connected." : "No news yet. It refreshes every 2 hours."}</li>`;
  } catch (e) {
    $("#newsStatus").textContent = "News unavailable right now.";
  }
}
$("#newsRefresh").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  const label = b.querySelector("span");
  b.disabled = true;
  label.textContent = "Refreshing…";
  $("#newsStatus").textContent = "Checking URA, ports and trade news sources. This takes about a minute…";
  try {
    const r = await api("/staff/news/refresh", { method: "POST" });
    await loadNews(true);
    toast(r.skipped ? "News was refreshed moments ago. Showing the latest." : r.inserted ? `${r.inserted} new ${r.inserted === 1 ? "story" : "stories"} added` : "You're up to date: no new stories since the last check");
  } catch (err) {
    toast(err.message, true);
    loadNews();
  }
  label.textContent = "Refresh";
  b.disabled = false;
});

async function refreshAll(flashId) {
  $("#refreshBtn").classList.add("spin");
  await Promise.all([loadStats(), loadShipments(flashId), loadQuotes()]);
  $("#refreshBtn").classList.remove("spin");
  $("#lastSync").textContent = "Synced " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
$("#refreshBtn").addEventListener("click", () => { refreshAll(); loadNews(); });

let timer = null;
function startAutoRefresh() {
  stopAutoRefresh();
  timer = setInterval(() => { if (!document.hidden && !$("#drawer").classList.contains("open")) refreshAll(); }, 60_000);
}
function stopAutoRefresh() { if (timer) clearInterval(timer); timer = null; }

// ---------------------------------------------------------------- filters
function setView(v, reload = true) {
  state.view = v;
  $$("#viewSeg button").forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-view") === v));
  if (reload) loadShipments();
}
$("#viewSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) { state.kpi = ""; setView(b.getAttribute("data-view")); loadStats(); }
});
let qTimer;
$("#q").addEventListener("input", (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { state.q = e.target.value.trim(); loadShipments(); }, 250);
});
$("#modeFilter").addEventListener("change", (e) => { state.mode = e.target.value; loadShipments(); });
$("#statusFilter").innerHTML += LK.STATUS_ORDER.map((k) => `<option value="${k}">${LK.STATUS[k].label}</option>`).join("");
$("#statusFilter").addEventListener("change", (e) => { state.status = e.target.value; loadShipments(); });

document.addEventListener("keydown", (e) => {
  if ($("#appView").hidden) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === "Escape") { closeOverlay($("#drawer")); closeOverlay($("#newModal")); }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
  if (e.key.toLowerCase() === "n" && !document.querySelector(".lk-overlay.open")) { e.preventDefault(); openNew(); }
});

// =====================================================================
// Corridor map (Leaflet)
// =====================================================================
const PLACES = {
  "mombasa": [-4.0435, 39.6682], "dar es salaam": [-6.8235, 39.2695], "dar": [-6.8235, 39.2695],
  "nairobi": [-1.2921, 36.8219], "naivasha": [-0.7167, 36.4333], "nakuru": [-0.3031, 36.08], "eldoret": [0.5143, 35.2698],
  "voi": [-3.3961, 38.5561], "malaba": [0.6363, 34.2747], "busia": [0.4608, 34.0922], "tororo": [0.6928, 34.1809],
  "jinja": [0.4244, 33.2042], "kampala": [0.3476, 32.5825], "bweyogerere": [0.3537, 32.6728], "entebbe": [0.0424, 32.4435],
  "mutukula": [-0.9982, 31.4167], "masaka": [-0.3338, 31.7341], "mbarara": [-0.6072, 30.6545], "bukoba": [-1.3317, 31.8122],
  "morogoro": [-6.8278, 37.6591], "dodoma": [-6.163, 35.7516], "isaka": [-3.9, 32.93], "mwanza": [-2.5164, 32.9175],
  "elegu": [3.5745, 32.0637], "gulu": [2.7724, 32.2881], "indian ocean": [-6.5, 45.5],
};
const NORTHERN = [[-4.0435, 39.6682], [-3.3961, 38.5561], [-1.2921, 36.8219], [-0.7167, 36.4333], [-0.3031, 36.08], [0.5143, 35.2698], [0.6363, 34.2747], [0.6928, 34.1809], [0.4244, 33.2042], [0.3476, 32.5825]];
const NORTHERN_BUSIA = [[0.5143, 35.2698], [0.4608, 34.0922], [0.4244, 33.2042]];
const CENTRAL = [[-6.8235, 39.2695], [-6.8278, 37.6591], [-6.163, 35.7516], [-4.82, 34.74], [-3.9, 32.93], [-2.5164, 32.9175], [-1.3317, 31.8122], [-0.9982, 31.4167], [-0.3338, 31.7341], [0.3476, 32.5825]];

let map = null;
let markerLayer = null;
function initMap() {
  if (map || !window.L) return;
  map = L.map("map", { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
  map.fitBounds([[-7.6, 30.8], [1.6, 46.2]]); // Uganda → Indian Ocean, so ships at sea are visible
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.polyline(NORTHERN, { color: "#0a97b0", weight: 4, opacity: 0.8 }).addTo(map);
  L.polyline(NORTHERN_BUSIA, { color: "#0a97b0", weight: 3, opacity: 0.6, dashArray: "6 6" }).addTo(map);
  L.polyline(CENTRAL, { color: "#ffb020", weight: 4, opacity: 0.85 }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  setTimeout(() => { map.invalidateSize(); map.fitBounds([[-7.6, 30.8], [1.6, 46.2]]); }, 200);
}

function placeFor(s) {
  const loc = (s.current_location || "").toLowerCase();
  for (const name of Object.keys(PLACES)) if (loc.includes(name)) return { key: name, ll: PLACES[name] };
  const port = (s.port || "").toLowerCase().includes("dar") ? "dar es salaam" : (s.port || "").toLowerCase().includes("entebbe") ? "entebbe" : "mombasa";
  const border = (s.border || "malaba").toLowerCase();
  switch (s.status) {
    case "at_sea": case "loaded_origin": return { key: "indian ocean", ll: PLACES["indian ocean"] };
    case "in_flight": return { key: "in the air", ll: [1.2, 38.5] };
    case "arrived_port": case "customs_clearance": case "released": return { key: port, ll: PLACES[port] };
    case "in_transit_road": return port === "dar es salaam" ? { key: "isaka", ll: PLACES.isaka } : { key: "nakuru", ll: PLACES.nakuru };
    case "at_border": return { key: border, ll: PLACES[border] || PLACES.malaba };
    case "arrived_kampala": case "delivered": return { key: "kampala", ll: PLACES.kampala };
    default: return null; // booked / on hold with no known location
  }
}
const PIN_CLASS = { at_sea: "ocean", in_flight: "ocean", loaded_origin: "ocean", arrived_port: "port", customs_clearance: "port", released: "port", in_transit_road: "road", at_border: "border", arrived_kampala: "home" };

function renderMap(list) {
  if (!map) return;
  markerLayer.clearLayers();
  const groups = {};
  let offMap = 0;
  for (const s of list) {
    const p = placeFor(s);
    if (!p) { offMap++; continue; }
    (groups[p.key] = groups[p.key] || { ll: p.ll, items: [] }).items.push(s);
  }
  for (const [name, g] of Object.entries(groups)) {
    const n = g.items.length;
    const size = 26 + Math.min(n, 10) * 3;
    const icon = L.divIcon({ className: "", html: `<div class="tk-pin ${PIN_CLASS[g.items[0].status] || ""}" style="width:${size}px;height:${size}px">${n}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    const popup = `<b style="text-transform:capitalize">${esc(name)}</b><br>` + g.items.map((s) =>
      `<a href="#" data-open="${s.id}" style="font-family:monospace">${esc(s.tracking_no)}</a> <span style="color:#64788a">${esc(LK.STATUS[s.status]?.label || s.status)}</span>`).join("<br>");
    L.marker(g.ll, { icon }).bindPopup(popup).bindTooltip(name, { direction: "top", offset: [0, -size / 2] }).addTo(markerLayer);
  }
  $("#mapNote").textContent = offMap ? offMap + " at origin / not placed" : "";
}
$("#map").addEventListener("click", (e) => {
  const a = e.target.closest("[data-open]");
  if (a) { e.preventDefault(); openDrawer(Number(a.getAttribute("data-open"))); }
});

// =====================================================================
// Overlays
// =====================================================================
function openOverlay(el) { el.classList.add("open"); document.body.style.overflow = "hidden"; }
function closeOverlay(el) {
  if (!el.classList.contains("open")) return;
  el.classList.remove("open");
  if (!document.querySelector(".lk-overlay.open")) document.body.style.overflow = "";
}
for (const el of [$("#drawer"), $("#newModal")]) {
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) closeOverlay(el); });
}

// ---------------------------------------------------------------- shared form fields
const PORTS = ["", "Mombasa", "Dar es Salaam", "Entebbe"];
const BORDERS = ["", "Malaba", "Busia", "Mutukula", "Elegu"];
const opt = (vals, cur, labels) => vals.map((v, i) => `<option value="${esc(v)}"${String(cur ?? "") === v ? " selected" : ""}>${esc(labels ? labels[i] : v || "—")}</option>`).join("");

function shipmentFields(s = {}) {
  return `
    <div class="row2">
      <div class="lk-field"><label>Client name *</label><input name="client_name" required maxlength="300" value="${esc(s.client_name || "")}"></div>
      <div class="lk-field"><label>Client phone</label><input name="client_phone" type="tel" value="${esc(s.client_phone || "")}" placeholder="07XXXXXXXX"></div>
    </div>
    <div class="row2">
      <div class="lk-field"><label>Client email</label><input name="client_email" type="email" value="${esc(s.client_email || "")}"></div>
      <div class="lk-field"><label>Mode *</label><select name="mode" required>${opt(["sea", "air", "road", "rail"], s.mode || "sea", ["Sea", "Air", "Road", "Rail"])}</select></div>
    </div>
    <div class="row2">
      <div class="lk-field"><label>Origin *</label><input name="origin" required value="${esc(s.origin || "")}" placeholder="e.g. Guangzhou, China"></div>
      <div class="lk-field"><label>Destination</label><input name="destination" value="${esc(s.destination || "Kampala, Uganda")}"></div>
    </div>
    <div class="row2">
      <div class="lk-field"><label>Port / airport</label><select name="port">${opt(PORTS, s.port)}</select></div>
      <div class="lk-field"><label>Border</label><select name="border">${opt(BORDERS, s.border)}</select></div>
    </div>
    <div class="row2">
      <div class="lk-field"><label>B/L (sea) or AWB (air) no.</label><input name="bl_awb_no" value="${esc(s.bl_awb_no || "")}" style="text-transform:uppercase" placeholder="Shipping line B/L or airline AWB"></div>
      <div class="lk-field"><label>House B/L / House AWB</label><input name="house_bl_no" value="${esc(s.house_bl_no || "")}" style="text-transform:uppercase" placeholder="If consolidated (e.g. via BINTEC)"></div>
    </div>
    <div class="lk-field"><label>Container no(s).</label><input name="container_no" value="${esc(s.container_no || "")}" style="text-transform:uppercase" placeholder="e.g. MSCU1234567, TGHU7654321">
      <small class="tk-sub">Separate several containers with commas. Clients can track with any of these, the B/L/AWB, or the tracking number.</small></div>
    <div class="lk-field"><label>Cargo description</label><input name="cargo_desc" value="${esc(s.cargo_desc || "")}"></div>
    <div class="row3">
      <div class="lk-field"><label>Packages</label><input name="packages" type="number" min="0" value="${esc(s.packages ?? "")}"></div>
      <div class="lk-field"><label>Weight (kg)</label><input name="weight_kg" type="number" min="0" step="0.01" value="${esc(s.weight_kg ?? "")}"></div>
      <div class="lk-field"><label>Assigned to</label><input name="assigned_to" value="${esc(s.assigned_to || "")}"></div>
    </div>
    <div class="row2">
      <div class="lk-field"><label>ETA</label><input name="eta" type="date" value="${esc(s.eta || "")}"></div>
      <div class="lk-field"><label>Free days end (port storage)</label><input name="free_days_end" type="date" value="${esc(s.free_days_end || "")}"></div>
    </div>`;
}
function readForm(form) {
  const d = {};
  new FormData(form).forEach((v, k) => { d[k] = typeof v === "string" ? v.trim() : v; });
  if (d.container_no) d.container_no = d.container_no.toUpperCase();
  if (d.bl_awb_no) d.bl_awb_no = d.bl_awb_no.toUpperCase();
  if (d.house_bl_no) d.house_bl_no = d.house_bl_no.toUpperCase();
  return d;
}

// ---------------------------------------------------------------- new shipment
function openNew() {
  $("#newForm").innerHTML = shipmentFields() + `
    <div class="row2">
      <div class="lk-field"><label>Starting status</label><select name="status">${opt(LK.STATUS_ORDER, "booked", LK.STATUS_ORDER.map((k) => LK.STATUS[k].label))}</select></div>
      <div class="lk-field"><label>Current location</label><input name="current_location" placeholder="e.g. Guangzhou"></div>
    </div>
    <div class="lk-alert" id="newAlert" role="alert"></div>
    <button class="lk-btn lk-btn-teal" type="submit"><i class="fa fa-plus"></i> Create shipment</button>`;
  openOverlay($("#newModal"));
  setTimeout(() => $("#newForm [name=client_name]").focus(), 60);
}
$("#newBtn").addEventListener("click", openNew);
$("#newForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#newForm [type=submit]");
  btn.disabled = true;
  try {
    const { shipment } = await api("/staff/shipments", { method: "POST", body: readForm(e.target) });
    closeOverlay($("#newModal"));
    toast("Created " + shipment.tracking_no);
    state.kpi = ""; setView("active", false);
    await refreshAll(shipment.id);
    openDrawer(shipment.id);
  } catch (err) {
    alertBox("#newAlert", "err", err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- drawer
function publicLink(s) {
  const base = location.href.replace(/logistics-tracker\.html.*$/, "logistics.html");
  return base + "?track=" + encodeURIComponent(s.tracking_no);
}
function clientWa(s) {
  const phone = (s.client_phone || "").replace(/\D/g, "").replace(/^0/, "256");
  if (!phone) return null;
  const st = LK.STATUS[s.status]?.label || s.status;
  const msg = `Hello ${s.client_name.split(" ")[0]}, here's an update from Laiken Logistics on shipment ${s.tracking_no}: ${st}` +
    (s.current_location ? ` (${s.current_location})` : "") + (s.eta && s.status !== "delivered" ? `. ETA: ${LK.fmtDate(s.eta)}` : "") +
    `.\nTrack it any time: ${publicLink(s)}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

async function openDrawer(id) {
  const inner = $("#drawerInner");
  inner.innerHTML = '<div style="display:grid;place-items:center;height:100%"><span class="lk-spinner"></span></div>';
  openOverlay($("#drawer"));
  try {
    const { shipment: s, events } = await api("/staff/shipments/" + id);
    renderDrawer(s, events);
  } catch (err) {
    inner.innerHTML = `<div class="tk-drawer-body"><div class="lk-alert err show">${esc(err.message)}</div><button class="lk-btn lk-btn-light" data-close>Close</button></div>`;
  }
}

function renderDrawer(s, events) {
  const wa = clientWa(s);
  const mode = LK.MODE[s.mode] || LK.MODE.sea;
  const fdDays = s.free_days_end ? LK.daysUntil(s.free_days_end) : null;
  const banners = [];
  if (freeDaysWarn(s)) banners.push(`<div class="lk-alert err show"><i class="fa fa-hourglass-half"></i> Free days ${fdDays < 0 ? "ended " + Math.abs(fdDays) + " day(s) ago. Storage charges may apply" : "end " + LK.etaText(s.free_days_end).toLowerCase() + " (" + LK.fmtDate(s.free_days_end) + ")"}.</div>`);
  if (s.status !== "delivered" && s.eta && LK.daysUntil(s.eta) < 0) banners.push(`<div class="lk-alert err show"><i class="fa fa-clock-o"></i> Past ETA by ${Math.abs(LK.daysUntil(s.eta))} day(s). Update the ETA or post an update.</div>`);

  $("#drawerInner").innerHTML = `
    <div class="tk-drawer-head">
      <button class="lk-close" data-close aria-label="Close"><i class="fa fa-times"></i></button>
      <div class="sub"><i class="fa ${mode.icon}"></i> ${mode.label} · ${esc(s.client_name)}</div>
      <h3>${esc(s.tracking_no)}</h3>
      <div>${LK.chip(s.status)} <span class="sub" style="margin-left:8px"><i class="fa fa-map-marker"></i> ${esc(s.current_location || "—")}</span></div>
      <div class="acts">
        ${wa ? `<a class="lk-btn lk-btn-wa lk-btn-sm" href="${wa}" target="_blank" rel="noopener"><i class="fa fa-whatsapp"></i> Send update to client</a>` : ""}
        <button class="lk-btn lk-btn-ghost lk-btn-sm" data-copy="${esc(publicLink(s))}"><i class="fa fa-link"></i> Copy tracking link</button>
        <a class="lk-btn lk-btn-ghost lk-btn-sm" href="${esc(publicLink(s))}" target="_blank" rel="noopener"><i class="fa fa-eye"></i> Client view</a>
      </div>
    </div>
    <div class="tk-drawer-body">
      ${banners.join("")}
      <form class="tk-card lk-form" id="evForm">
        <h4><i class="fa fa-bullhorn"></i> Post an update</h4>
        <div class="tk-status-pick" role="radiogroup" aria-label="New status">
          ${LK.STATUS_ORDER.map((k) => `<label><input type="radio" name="status" value="${k}"${k === s.status ? " checked" : ""}>${LK.chip(k)}</label>`).join("")}
        </div>
        <div class="lk-field"><label>Location</label><input name="location" value="${esc(s.current_location || "")}" placeholder="e.g. Malaba border"></div>
        <div class="lk-field"><label>Note</label><textarea name="note" rows="2" placeholder="e.g. Entry lodged on ASYCUDA, awaiting assessment"></textarea></div>
        <label class="tk-check"><input type="checkbox" name="is_public" checked> Show this update to the client on the tracking page</label>
        <div class="lk-alert" id="evAlert" role="alert"></div>
        <button class="lk-btn lk-btn-teal" type="submit"><i class="fa fa-paper-plane"></i> Post update</button>
      </form>

      <div class="tk-card">
        <h4><i class="fa fa-history"></i> Timeline</h4>
        ${events.length ? `<ol class="lk-timeline">${events.map((e) => {
          const st = LK.STATUS[e.status] || { label: e.status, icon: "fa-circle" };
          return `<li><span class="dot"><i class="fa ${st.icon}"></i></span><b>${esc(st.label)}${e.is_public ? "" : '<span class="private">INTERNAL</span>'}</b>
            <div class="meta">${esc(e.location || "")}${e.location ? " · " : ""}${LK.fmtDate(e.created_at, true)}${e.created_by ? " · " + esc(e.created_by) : ""}</div>
            ${e.note ? `<div class="note">${esc(e.note)}</div>` : ""}</li>`;
        }).join("")}</ol>` : '<p class="tk-sub">No updates yet.</p>'}
      </div>

      <form class="tk-card lk-form" id="editForm">
        <h4><i class="fa fa-pencil"></i> Shipment details</h4>
        ${shipmentFields(s)}
        <div class="lk-alert" id="editAlert" role="alert"></div>
        <button class="lk-btn lk-btn-light" type="submit"><i class="fa fa-save"></i> Save details</button>
        <p class="tk-sub" style="margin:0">Created ${LK.fmtDate(s.created_at, true)}${s.created_by ? " by " + esc(s.created_by) : ""}</p>
      </form>
    </div>`;

  $("#drawerInner [data-copy]").addEventListener("click", (e) => {
    const link = e.currentTarget.getAttribute("data-copy");
    navigator.clipboard?.writeText(link).then(() => toast("Tracking link copied"), () => prompt("Copy link:", link));
  });

  $("#evForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      status: f.status.value,
      location: f.location.value.trim() || null,
      note: f.note.value.trim() || null,
      is_public: f.is_public.checked,
    };
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await api(`/staff/shipments/${s.id}/events`, { method: "POST", body });
      toast("Update posted");
      openDrawer(s.id);
      refreshAll(s.id);
    } catch (err) {
      alertBox("#evAlert", "err", err.message);
      btn.disabled = false;
    }
  });

  $("#editForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await api(`/staff/shipments/${s.id}`, { method: "PATCH", body: readForm(e.target) });
      toast("Details saved");
      openDrawer(s.id);
      refreshAll(s.id);
    } catch (err) {
      alertBox("#editAlert", "err", err.message);
      btn.disabled = false;
    }
  });
}

// =====================================================================
// Boot (last, so every function and variable above is initialised)
// =====================================================================
(async function boot() {
  if (LK.demo) return showLogin();
  if (storedSession()) return enterApp();
  try {
    const auth = await getAuth();
    const { data } = await auth.getSession();
    if (data?.user) return enterApp();
  } catch (err) {
    console.error(err);
  }
  showLogin();
})();
