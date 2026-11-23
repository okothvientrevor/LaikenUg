/* Laiken Logistics — shared helpers for logistics.html, logistics-news.html and logistics-tracker.html */
(function () {
  "use strict";
  var cfg = window.LK_CONFIG || {};
  var LK = (window.LK = { config: cfg });
  LK.demo = !cfg.API_BASE;

  // ------------------------------------------------------------------ statuses
  LK.STATUS = {
    booked:            { label: "Booked",               icon: "fa-bookmark",       tone: "slate" },
    loaded_origin:     { label: "Loaded at origin",     icon: "fa-cubes",          tone: "blue" },
    at_sea:            { label: "At sea",               icon: "fa-ship",           tone: "blue" },
    in_flight:         { label: "In flight",            icon: "fa-plane",          tone: "blue" },
    arrived_port:      { label: "Arrived at port",      icon: "fa-anchor",         tone: "teal" },
    customs_clearance: { label: "Customs clearance",    icon: "fa-file-text-o",    tone: "amber" },
    released:          { label: "Released",             icon: "fa-unlock",         tone: "teal" },
    in_transit_road:   { label: "On the road",          icon: "fa-truck",          tone: "indigo" },
    at_border:         { label: "At the border",        icon: "fa-flag",           tone: "orange" },
    arrived_kampala:   { label: "Arrived in Uganda",    icon: "fa-map-marker",     tone: "teal" },
    delivered:         { label: "Delivered",            icon: "fa-check-circle",   tone: "green" },
    on_hold:           { label: "On hold",              icon: "fa-pause-circle",   tone: "red" },
  };
  LK.STATUS_ORDER = Object.keys(LK.STATUS);
  LK.MODE = {
    sea:  { label: "Sea freight",  icon: "fa-ship" },
    air:  { label: "Air freight",  icon: "fa-plane" },
    road: { label: "Road freight", icon: "fa-truck" },
    rail: { label: "Rail freight", icon: "fa-train" },
  };

  /** Journey stages shown on the public progress bar, per mode. Each lists the statuses it covers. */
  LK.stagesFor = function (mode) {
    var intl = mode === "air"
      ? { label: "In flight", icon: "fa-plane", s: ["loaded_origin", "in_flight", "at_sea"] }
      : { label: mode === "road" ? "Dispatched" : "At sea", icon: mode === "road" ? "fa-truck" : "fa-ship", s: ["loaded_origin", "at_sea", "in_flight"] };
    var port = mode === "air"
      ? { label: "Arrived Entebbe", icon: "fa-plane", s: ["arrived_port"] }
      : { label: "At port", icon: "fa-anchor", s: ["arrived_port"] };
    var stages = [
      { label: "Booked", icon: "fa-bookmark", s: ["booked"] },
      intl,
      port,
      { label: "Customs", icon: "fa-file-text-o", s: ["customs_clearance", "released"] },
    ];
    if (mode !== "air") stages.push({ label: "On the road", icon: "fa-truck", s: ["in_transit_road", "at_border", "arrived_kampala"] });
    stages.push({ label: "Delivered", icon: "fa-check", s: ["delivered"] });
    return stages;
  };
  LK.stageIndex = function (stages, status) {
    for (var i = 0; i < stages.length; i++) if (stages[i].s.indexOf(status) !== -1) return i;
    return 0;
  };

  // ------------------------------------------------------------------ formatting
  LK.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  LK.timeAgo = function (d) {
    var t = new Date(d).getTime();
    if (isNaN(t)) return "";
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    var m = Math.round(s / 60); if (m < 60) return m + " min ago";
    var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    var dd = Math.round(h / 24); if (dd < 30) return dd + (dd === 1 ? " day ago" : " days ago");
    return LK.fmtDate(d);
  };
  LK.fmtDate = function (d, withTime) {
    if (!d) return "—";
    var date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00") : new Date(d);
    if (isNaN(date)) return "—";
    var opts = { day: "numeric", month: "short", year: "numeric" };
    if (withTime) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
    return date.toLocaleString("en-GB", opts);
  };
  /** Days from today to a YYYY-MM-DD date (negative = past). */
  LK.daysUntil = function (d) {
    if (!d) return null;
    var target = new Date(d + "T00:00:00");
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  };
  LK.etaText = function (d, status) {
    if (status === "delivered") return "Delivered";
    var n = LK.daysUntil(d);
    if (n === null) return "To be confirmed";
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n > 1) return "In " + n + " days";
    return Math.abs(n) + (n === -1 ? " day overdue" : " days overdue");
  };
  LK.chip = function (status) {
    var s = LK.STATUS[status] || { label: status, icon: "fa-circle", tone: "slate" };
    return '<span class="lk-chip lk-tone-' + s.tone + '"><i class="fa ' + s.icon + '" aria-hidden="true"></i>' + LK.esc(s.label) + "</span>";
  };
  LK.NEWS_CATS = {
    ura: { label: "URA & Tax", icon: "fa-university" },
    ports: { label: "Ports", icon: "fa-anchor" },
    eac: { label: "EAC", icon: "fa-globe" },
    transport: { label: "Transport", icon: "fa-truck" },
    trade: { label: "Trade", icon: "fa-line-chart" },
  };
  /** News card image: the story's own photo, or a category photo (also used if the photo fails to load). */
  LK.newsThumb = function (n) {
    var cat = LK.NEWS_CATS[n.category] ? n.category : "trade";
    var img = n.image_url
      ? '<img src="' + LK.esc(n.image_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
      : '<span class="src">' + LK.esc(n.source || "") + "</span>";
    return '<div class="thumb" data-cat="' + cat + '">' + img + "</div>";
  };
  LK.waLink = function (text) {
    return "https://wa.me/" + cfg.WHATSAPP + (text ? "?text=" + encodeURIComponent(text) : "");
  };

  // ------------------------------------------------------------------ API
  LK.api = function (path, opts) {
    opts = opts || {};
    if (LK.demo) return LK.demoApi(path, opts);
    var headers = { "content-type": "application/json" };
    if (opts.token) headers.authorization = "Bearer " + opts.token;
    return fetch(cfg.API_BASE.replace(/\/$/, "") + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "Request failed (" + res.status + ")");
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error("Can't reach the Laiken server. Check your internet connection and try again.");
    });
  };

  // ------------------------------------------------------------------ demo mode
  // Sample data so the pages can be previewed before the backend is deployed. Nothing here is saved.
  var day = 86400000;
  function iso(offsetDays) { return new Date(Date.now() + offsetDays * day).toISOString(); }
  function dateOnly(offsetDays) { return iso(offsetDays).slice(0, 10); }
  var demoShipments = [
    { id: 1, tracking_no: "LKL-DEMO-001", client_name: "Sample Client A", client_phone: "0700000001", mode: "sea", origin: "Guangzhou, China", destination: "Kampala, Uganda", port: "Mombasa", border: "Malaba", container_no: "MSCU1234567", bl_awb_no: "MEDU9876543", cargo_desc: "Building materials (tiles)", packages: 420, weight_kg: 18500, status: "customs_clearance", current_location: "Mombasa Port", eta: dateOnly(9), free_days_end: dateOnly(2), assigned_to: "Clearing desk", updated_at: iso(-0.2), created_at: iso(-30) },
    { id: 2, tracking_no: "LKL-DEMO-002", client_name: "Sample Client B", client_phone: "0700000002", mode: "sea", origin: "Jebel Ali, Dubai", destination: "Kampala, Uganda", port: "Mombasa", border: "Busia", container_no: "TGHU7654321", bl_awb_no: "MAEU5550001", cargo_desc: "Electronics & accessories", packages: 160, weight_kg: 6200, status: "in_transit_road", current_location: "Nakuru, Kenya", eta: dateOnly(3), free_days_end: null, assigned_to: "Road desk", updated_at: iso(-0.25), created_at: iso(-25) },
    { id: 3, tracking_no: "LKL-DEMO-003", client_name: "Sample Client C", client_phone: "0700000003", mode: "air", origin: "Dubai (DXB)", destination: "Kampala, Uganda", port: "Entebbe", border: null, container_no: null, bl_awb_no: "176-12345675", cargo_desc: "Phone spares", packages: 12, weight_kg: 340, status: "delivered", current_location: "Kampala", eta: dateOnly(-2), free_days_end: null, assigned_to: "Air desk", updated_at: iso(-2), created_at: iso(-7) },
    { id: 4, tracking_no: "LKL-DEMO-004", client_name: "Sample Client D", client_phone: "0700000004", mode: "sea", origin: "Shanghai, China", destination: "Mbarara, Uganda", port: "Dar es Salaam", border: "Mutukula", container_no: "CMAU2468101", bl_awb_no: "CMDU3332221", cargo_desc: "Solar panels", packages: 300, weight_kg: 9800, status: "at_sea", current_location: "Indian Ocean", eta: dateOnly(21), free_days_end: null, assigned_to: "Clearing desk", updated_at: iso(-7), created_at: iso(-10) },
    { id: 5, tracking_no: "LKL-DEMO-005", client_name: "Sample Client E", client_phone: "0700000005", mode: "road", origin: "Mombasa, Kenya", destination: "Kampala, Uganda", port: "Mombasa", border: "Malaba", container_no: "OOLU1357913", bl_awb_no: "OOLU0001112", cargo_desc: "Used motor vehicle", packages: 1, weight_kg: 1450, status: "at_border", current_location: "Malaba Border", eta: dateOnly(1), free_days_end: null, assigned_to: "Road desk", updated_at: iso(-0.12), created_at: iso(-6) },
  ];
  var demoEvents = {
    1: [["customs_clearance", "Mombasa Port", "Awaiting PVoC certificate copy", false, -0.2], ["customs_clearance", "Mombasa Port", "Entry lodged on URA ASYCUDA", true, -1], ["arrived_port", "Mombasa Port", "Vessel berthed, container discharged", true, -4], ["at_sea", "Indian Ocean", "Vessel sailing to Mombasa", true, -26], ["loaded_origin", "Nansha Port", "Container loaded on vessel", true, -27], ["booked", "Guangzhou, China", "Booking confirmed with shipping line", true, -30]],
    2: [["in_transit_road", "Nakuru, Kenya", "Truck UBK 123X on the Northern Corridor", true, -0.25], ["released", "Mombasa Port", "Release order issued", true, -3], ["arrived_port", "Mombasa Port", "Discharged", true, -8], ["at_sea", "Indian Ocean", "Sailing", true, -22], ["booked", "Jebel Ali", "Booking confirmed", true, -25]],
    3: [["delivered", "Kampala", "Delivered and signed for", true, -2], ["customs_clearance", "Entebbe Airport", "Cleared by URA", true, -4], ["in_flight", "Dubai (DXB)", "Departed on flight", true, -6]],
    4: [["at_sea", "Indian Ocean", "Vessel en route to Dar es Salaam", true, -7], ["booked", "Shanghai", "Booking confirmed", true, -10]],
    5: [["at_border", "Malaba Border", "Queued at Malaba OSBP", true, -0.12], ["in_transit_road", "Eldoret, Kenya", "On car carrier", true, -2], ["released", "Mombasa Port", "Vehicle released", true, -4]],
  };
  Object.keys(demoEvents).forEach(function (id) {
    demoEvents[id] = demoEvents[id].map(function (e, i) {
      return { id: Number(id) * 100 + i, shipment_id: Number(id), status: e[0], location: e[1], note: e[2], is_public: e[3], created_by: "demo", created_at: iso(e[4]) };
    });
  });
  var demoQuotes = [
    { id: 1, name: "Sample Lead", phone: "0700000009", email: null, mode: "sea", origin: "China", cargo: "1×40ft furniture", message: "Need price to Kampala", handled: false, created_at: iso(-0.1) },
  ];

  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 250); }); }
  function fail(msg, status) { var e = new Error(msg); e.status = status; return Promise.reject(e); }

  LK.demoApi = function (path, opts) {
    var method = opts.method || "GET";
    var url = new URL(path, "https://demo.local");
    var p = url.pathname;
    var m;
    if ((m = p.match(/^\/track\/(.+)$/))) {
      var norm = function (v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); };
      var no = norm(decodeURIComponent(m[1]));
      var conts = function (x) { return String(x.container_no || "").split(/[,;\/\n]+/).map(norm); };
      var s = demoShipments.find(function (x) { return [norm(x.tracking_no), norm(x.bl_awb_no), norm(x.house_bl_no)].concat(conts(x)).indexOf(no) !== -1; });
      if (!s) return fail("We couldn't find a shipment with that number.", 404);
      var pub = Object.assign({}, s); delete pub.client_name; delete pub.client_phone; delete pub.cargo_desc; delete pub.id;
      pub.containers = String(s.container_no || "").split(/[,;\/\n]+/).map(function (c) { return c.trim(); }).filter(Boolean); delete pub.container_no;
      pub.matched_by = norm(s.tracking_no) === no ? "tracking" : norm(s.bl_awb_no) === no ? (s.mode === "air" ? "awb" : "bl") : norm(s.house_bl_no) === no ? "house_bl" : "container";
      return delay({ shipment: pub, events: demoEvents[s.id].filter(function (e) { return e.is_public; }) });
    }
    if (p === "/news") return delay({ items: [], refreshedAt: null, demo: true });
    if (p === "/quotes" && method === "POST") return delay({ ok: true, demo: true });
    if (p === "/staff/me") return delay({ email: "demo@laikenug.com", name: "Demo User", role: "admin" });
    if (p === "/staff/stats") {
      var act = demoShipments.filter(function (x) { return x.status !== "delivered"; });
      var c = function (f) { return demoShipments.filter(f).length; };
      return delay({
        active: act.length,
        at_customs: c(function (x) { return ["arrived_port", "customs_clearance"].indexOf(x.status) !== -1; }),
        on_road: c(function (x) { return ["released", "in_transit_road", "at_border"].indexOf(x.status) !== -1; }),
        in_transit_intl: c(function (x) { return ["at_sea", "in_flight", "loaded_origin"].indexOf(x.status) !== -1; }),
        delivered_month: c(function (x) { return x.status === "delivered"; }),
        overdue: c(function (x) { return x.status !== "delivered" && LK.daysUntil(x.eta) < 0; }),
        free_days_alert: c(function (x) { return ["arrived_port", "customs_clearance"].indexOf(x.status) !== -1 && x.free_days_end && LK.daysUntil(x.free_days_end) <= 3; }),
        on_hold: c(function (x) { return x.status === "on_hold"; }),
        open_quotes: demoQuotes.filter(function (q) { return !q.handled; }).length,
      });
    }
    if (p === "/staff/shipments" && method === "GET") {
      var q = (url.searchParams.get("q") || "").toLowerCase();
      var view = url.searchParams.get("view") || "active";
      var st = url.searchParams.get("status"), mode = url.searchParams.get("mode");
      var list = demoShipments.filter(function (x) {
        if (st) { if (x.status !== st) return false; }
        else if (view === "active" && x.status === "delivered") return false;
        else if (view === "delivered" && x.status !== "delivered") return false;
        if (mode && x.mode !== mode) return false;
        if (q && JSON.stringify(x).toLowerCase().indexOf(q) === -1) return false;
        return true;
      }).sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
      return delay({ shipments: list });
    }
    if (p === "/staff/shipments" && method === "POST") {
      var b = opts.body || {};
      if (!b.client_name || !b.mode || !b.origin) return fail("client_name, mode and origin are required", 400);
      var id = demoShipments.length ? Math.max.apply(null, demoShipments.map(function (x) { return x.id; })) + 1 : 1;
      var code = Math.random().toString(36).slice(2, 8).toUpperCase();
      var ns = Object.assign({ status: "booked", destination: "Kampala, Uganda" }, b, { id: id, tracking_no: "LKL-26-" + code, created_at: iso(0), updated_at: iso(0) });
      demoShipments.unshift(ns);
      demoEvents[id] = [{ id: id * 100, shipment_id: id, status: ns.status, location: ns.current_location || ns.origin, note: "Shipment booked with Laiken Logistics", is_public: true, created_by: "demo", created_at: iso(0) }];
      return delay({ shipment: ns });
    }
    if ((m = p.match(/^\/staff\/shipments\/(\d+)$/))) {
      var sh = demoShipments.find(function (x) { return x.id === Number(m[1]); });
      if (!sh) return fail("Shipment not found", 404);
      if (method === "PATCH") { Object.assign(sh, opts.body, { updated_at: iso(0) }); return delay({ shipment: sh }); }
      return delay({ shipment: sh, events: demoEvents[sh.id] || [] });
    }
    if ((m = p.match(/^\/staff\/shipments\/(\d+)\/events$/))) {
      var s2 = demoShipments.find(function (x) { return x.id === Number(m[1]); });
      var e = opts.body || {};
      s2.status = e.status; if (e.location) s2.current_location = e.location; s2.updated_at = iso(0);
      var ev = { id: Date.now(), shipment_id: s2.id, status: e.status, location: e.location || s2.current_location, note: e.note, is_public: e.is_public !== false, created_by: "demo@laikenug.com", created_at: iso(0) };
      (demoEvents[s2.id] = demoEvents[s2.id] || []).unshift(ev);
      return delay({ shipment: s2, event: ev });
    }
    if (p === "/staff/quotes" && method === "GET") return delay({ quotes: demoQuotes });
    if ((m = p.match(/^\/staff\/quotes\/(\d+)$/))) {
      var qq = demoQuotes.find(function (x) { return x.id === Number(m[1]); });
      qq.handled = !!(opts.body || {}).handled; return delay({ quote: qq });
    }
    if (p === "/staff/news/refresh") return delay({ ok: true, inserted: 0, demo: true });
    return fail("Not available in demo mode", 404);
  };

  // ------------------------------------------------------------------ shared UI behaviour
  document.addEventListener("DOMContentLoaded", function () {
    // Sticky header shadow + mobile menu
    var header = document.querySelector(".lk-header");
    if (header) {
      var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 24); };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      var toggle = header.querySelector(".lk-menu-toggle");
      if (toggle) toggle.addEventListener("click", function () {
        var open = header.classList.toggle("menu-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      header.querySelectorAll(".lk-nav a").forEach(function (a) {
        a.addEventListener("click", function () { header.classList.remove("menu-open"); });
      });
    }
    // Footer year
    document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
    // WhatsApp / phone / email links from config
    document.querySelectorAll("[data-wa]").forEach(function (a) { a.href = LK.waLink(a.getAttribute("data-wa")); });
    // Scroll animations
    if (window.AOS) window.AOS.init({ duration: 700, once: true, offset: 60 });
    // Demo banner
    if (LK.demo) document.documentElement.classList.add("lk-is-demo");
  });
})();
