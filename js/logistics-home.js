/* logistics.html — tracking modal, news ticker, news cards, quote form, counters */
(function () {
  "use strict";
  var LK = window.LK;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  // ------------------------------------------------------------ toast
  var toastTimer;
  window.lkToast = function (msg, isErr) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "lk-toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "lk-toast"; }, 3800);
  };

  // ------------------------------------------------------------ counters
  var counters = document.querySelectorAll(".lk-count");
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      var el = e.target;
      var since = el.getAttribute("data-years-since");
      var target = since ? new Date().getFullYear() - Number(since) : Number(el.getAttribute("data-target"));
      var start = performance.now(), dur = 1400;
      (function tick(now) {
        var p = Math.min(1, (now - start) / dur);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      })(start);
    });
  }, { threshold: 0.4 });
  counters.forEach(function (c) { io.observe(c); });

  // ------------------------------------------------------------ tracking
  var modal = $("#trackModal");
  var lastFocus;
  function openModal() {
    lastFocus = document.activeElement;
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    setTimeout(function () { $(".lk-close", modal).focus(); }, 50);
  }
  function closeModal() {
    modal.classList.remove("open");
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
    if (/[?&]track=/.test(location.search)) history.replaceState(null, "", location.pathname + location.hash);
  }
  modal.addEventListener("click", function (e) { if (e.target === modal || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); });

  function renderTracking(data) {
    var s = data.shipment, ev = data.events || [];
    var stages = LK.stagesFor(s.mode);
    var idx = LK.stageIndex(stages, s.status);
    var delivered = s.status === "delivered";
    var mode = LK.MODE[s.mode] || LK.MODE.sea;
    $("#trackTitle").innerHTML = '<i class="fa ' + mode.icon + '"></i> ' + LK.esc(s.tracking_no);

    var steps = stages.map(function (st, i) {
      var cls = i < idx || (delivered && i === idx) ? "done" : i === idx ? "current" : "";
      if (i === stages.length - 1) cls += " final";
      return '<div class="st ' + cls + '"><div class="ic"><i class="fa ' + (i < idx || delivered ? "fa-check" : st.icon) + '"></i></div><span>' + st.label + "</span></div>";
    }).join("");
    var pct = stages.length > 1 ? (idx / (stages.length - 1)) * 100 : 0;

    var onHold = s.status === "on_hold"
      ? '<div class="lk-alert err show" style="margin-bottom:18px"><i class="fa fa-pause-circle"></i> This shipment is on hold. Our team will contact you, or message us on WhatsApp for details.</div>'
      : "";

    var timeline = ev.length
      ? '<ol class="lk-timeline">' + ev.map(function (e) {
          var st = LK.STATUS[e.status] || { label: e.status, icon: "fa-circle" };
          return '<li><span class="dot"><i class="fa ' + st.icon + '"></i></span><b>' + LK.esc(st.label) + "</b>" +
            '<div class="meta">' + LK.esc(e.location || "") + (e.location ? " · " : "") + LK.fmtDate(e.created_at, true) + "</div>" +
            (e.note ? '<div class="note">' + LK.esc(e.note) + "</div>" : "") + "</li>";
        }).join("") + "</ol>"
      : '<p style="color:var(--lk-muted)">No updates yet. We\'ll post the first one soon.</p>';

    var air = s.mode === "air";
    var MATCH = { tracking: "Laiken tracking number", bl: "Bill of Lading (B/L)", house_bl: "House B/L", awb: "Air Waybill (AWB)", house_awb: "House AWB", container: "container number" };
    var refs = [];
    if (s.bl_awb_no) refs.push("<div><dt>" + (air ? "AWB" : "B/L") + "</dt><dd>" + LK.esc(s.bl_awb_no) + "</dd></div>");
    if (s.house_bl_no) refs.push("<div><dt>" + (air ? "House AWB" : "House B/L") + "</dt><dd>" + LK.esc(s.house_bl_no) + "</dd></div>");
    if (s.containers && s.containers.length) refs.push("<div><dt>" + (s.containers.length > 1 ? "Containers" : "Container") + "</dt><dd>" + s.containers.map(LK.esc).join("<br>") + "</dd></div>");

    var shareUrl = location.origin + location.pathname + "?track=" + encodeURIComponent(s.tracking_no);
    $("#trackBody").innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px">' +
        '<span style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + LK.chip(s.status) +
        (s.matched_by && s.matched_by !== "tracking" ? '<span style="color:var(--lk-muted);font-size:13px">Found by ' + MATCH[s.matched_by] + "</span>" : "") + "</span>" +
        '<span style="color:var(--lk-muted);font-size:13.5px"><i class="fa fa-refresh"></i> Updated ' + LK.timeAgo(s.updated_at) + "</span>" +
      "</div>" + onHold +
      '<div class="lk-progress"><div class="bar"></div>' + steps + "</div>" +
      '<dl class="lk-kv">' +
        "<div><dt>From</dt><dd>" + LK.esc(s.origin) + "</dd></div>" +
        "<div><dt>To</dt><dd>" + LK.esc(s.destination) + "</dd></div>" +
        "<div><dt>Now at</dt><dd>" + LK.esc(s.current_location || "—") + "</dd></div>" +
        "<div><dt>Mode</dt><dd>" + mode.label + "</dd></div>" +
        "<div><dt>" + (s.mode === "air" ? "Airport" : "Port") + "</dt><dd>" + LK.esc(s.port || "—") + (s.border ? " · via " + LK.esc(s.border) : "") + "</dd></div>" +
        "<div><dt>ETA</dt><dd>" + (delivered ? "Delivered" : LK.fmtDate(s.eta)) + (s.eta && !delivered ? ' <small style="color:var(--lk-teal-600)">(' + LK.etaText(s.eta, s.status) + ")</small>" : "") + "</dd></div>" +
      "</dl>" +
      (refs.length ? '<dl class="lk-kv">' + refs.join("") + "</dl>" : "") +
      '<h4 style="font-size:16px;margin-bottom:14px">Updates</h4>' + timeline +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' +
        '<a class="lk-btn lk-btn-wa lk-btn-sm" target="_blank" rel="noopener" href="' + LK.waLink("Hello Laiken, I'd like an update on shipment " + s.tracking_no + ".") + '"><i class="fa fa-whatsapp"></i> Ask about this shipment</a>' +
        '<button class="lk-btn lk-btn-light lk-btn-sm" id="shareTrack"><i class="fa fa-link"></i> Copy tracking link</button>' +
      "</div>";

    requestAnimationFrame(function () {
      var bar = $(".lk-progress .bar", modal);
      var wrap = $(".lk-progress", modal);
      if (!bar || !wrap) return;
      var edge = 50 / stages.length + "%"; // centre of the first/last stage icon
      wrap.style.setProperty("--lk-edge", edge);
      bar.style.width = "calc((100% - 2 * " + edge + ") * " + pct / 100 + ")";
    });
    $("#shareTrack").addEventListener("click", function () {
      (navigator.clipboard ? navigator.clipboard.writeText(shareUrl) : Promise.reject()).then(
        function () { lkToast("Tracking link copied"); },
        function () { prompt("Copy this link:", shareUrl); }
      );
    });
  }

  function track(no) {
    no = (no || "").trim().toUpperCase();
    if (!no) return;
    $("#trackTitle").textContent = no;
    $("#trackBody").innerHTML = '<div style="text-align:center;padding:40px 0"><span class="lk-spinner"></span><p style="color:var(--lk-muted);margin-top:12px">Finding your shipment…</p></div>';
    openModal();
    LK.api("/track/" + encodeURIComponent(no)).then(renderTracking).catch(function (err) {
      $("#trackBody").innerHTML =
        '<div class="lk-empty" style="border:0"><i class="fa fa-search"></i><h4 style="color:var(--lk-ink)">' +
        (err.status === 404 || err.status === 400 ? "No shipment found" : "Couldn't load tracking") + "</h4><p>" + LK.esc(err.message) +
        " Check the number and try again. You can use your B/L, AWB, container or Laiken tracking number. Or ask us on WhatsApp.</p>" +
        '<a class="lk-btn lk-btn-wa lk-btn-sm" target="_blank" rel="noopener" href="' + LK.waLink("Hello Laiken, I can't find my shipment " + no + " on the tracking page.") + '"><i class="fa fa-whatsapp"></i> Ask on WhatsApp</a></div>';
    });
  }

  $("#trackForm").addEventListener("submit", function (e) {
    e.preventDefault();
    track($("#trackInput").value);
  });
  document.querySelectorAll("[data-try]").forEach(function (b) {
    b.addEventListener("click", function () {
      $("#trackInput").value = b.getAttribute("data-try");
      track(b.getAttribute("data-try"));
    });
  });
  var deep = new URLSearchParams(location.search).get("track");
  if (deep) { $("#trackInput").value = deep; track(deep); }

  // ------------------------------------------------------------ news
  function newsCard(n) {
    var cat = LK.NEWS_CATS[n.category] || LK.NEWS_CATS.trade;
    return '<a class="lk-news-card" href="' + LK.esc(n.url) + '" target="_blank" rel="noopener" data-aos="fade-up">' +
      LK.newsThumb(n) +
      '<div class="body"><span class="lk-cat ' + LK.esc(n.category) + '"><i class="fa ' + cat.icon + '"></i>' + cat.label + "</span>" +
      "<h3>" + LK.esc(n.title) + "</h3>" + (n.summary ? "<p>" + LK.esc(n.summary) + "</p>" : "") +
      '<div class="lk-news-meta"><b>' + LK.esc(n.source || "") + "</b><span>·</span><span>" + LK.timeAgo(n.published_at) + "</span></div></div></a>";
  }

  LK.api("/news?limit=12").then(function (data) {
    var items = data.items || [];
    var track = $("#tickerTrack");
    if (items.length) {
      // URA stories first in the ticker
      var tick = items.slice().sort(function (a, b) { return (b.category === "ura") - (a.category === "ura"); }).slice(0, 10);
      var html = tick.map(function (n) {
        var cat = LK.NEWS_CATS[n.category] || LK.NEWS_CATS.trade;
        return '<a href="' + LK.esc(n.url) + '" target="_blank" rel="noopener"><span class="tag">' + cat.label + "</span>" + LK.esc(n.title) + "</a>";
      }).join("");
      track.innerHTML = html + html; // duplicated for a seamless loop
      track.style.setProperty("--lk-ticker-dur", Math.max(40, tick.length * 9) + "s");
      $("#newsGrid").innerHTML = items.slice(0, 3).map(newsCard).join("");
    } else {
      track.innerHTML = '<a href="logistics-news.html"><span class="tag">News</span>' +
        (data.demo ? "The live news feed appears here once the backend is connected." : "News is being collected. Check back shortly.") + "</a>";
      track.style.animation = "none";
      $("#newsGrid").innerHTML = '<div class="lk-empty" style="grid-column:1/-1"><i class="fa fa-newspaper-o"></i>' +
        (data.demo ? "URA and logistics headlines will appear here once the backend is connected." : "No news collected yet. The feed refreshes every 2 hours.") +
        '<br><a href="https://ura.go.ug" target="_blank" rel="noopener">Visit ura.go.ug</a></div>';
    }
  }).catch(function () {
    $("#tickerTrack").innerHTML = '<a href="https://ura.go.ug" target="_blank" rel="noopener"><span class="tag">URA</span>Visit ura.go.ug for the latest notices</a>';
    $("#tickerTrack").style.animation = "none";
    $("#newsGrid").innerHTML = '<div class="lk-empty" style="grid-column:1/-1"><i class="fa fa-wifi"></i>News is unavailable right now.</div>';
  });

  // ------------------------------------------------------------ services -> quote form
  document.querySelectorAll(".lk-svc[data-mode]").forEach(function (a) {
    a.addEventListener("click", function () {
      var sel = $("#qMode");
      if (sel) sel.value = a.getAttribute("data-mode");
      setTimeout(function () { var n = $("#qName"); if (n) n.focus({ preventScroll: true }); }, 600);
    });
  });

  // ------------------------------------------------------------ quote form
  var qf = $("#quoteForm");
  var qAlert = $("#quoteAlert");
  function formData() {
    var d = {};
    new FormData(qf).forEach(function (v, k) { d[k] = String(v).trim(); });
    return d;
  }
  function showAlert(kind, msg) { qAlert.className = "lk-alert show " + kind; qAlert.textContent = msg; }
  qf.addEventListener("submit", function (e) {
    e.preventDefault();
    var d = formData();
    if (!d.name || !d.phone) return showAlert("err", "Please add your name and phone number.");
    var btn = qf.querySelector("[type=submit]");
    btn.disabled = true;
    LK.api("/quotes", { method: "POST", body: d }).then(function (res) {
      showAlert("ok", res.demo
        ? "Preview mode: the form works, but nothing was saved. It goes live once the backend is connected."
        : "Thank you, " + d.name.split(" ")[0] + "! An agent will contact you shortly.");
      if (!res.demo) qf.reset();
    }).catch(function (err) {
      showAlert("err", err.message + " You can also send it on WhatsApp.");
    }).then(function () { btn.disabled = false; });
  });
  $("#quoteWa").addEventListener("click", function () {
    var d = formData();
    var lines = ["Hello Laiken Logistics, I'd like a quote."];
    if (d.name) lines.push("Name: " + d.name);
    if (d.mode) lines.push("Mode: " + d.mode);
    if (d.origin) lines.push("From: " + d.origin);
    if (d.cargo) lines.push("Cargo: " + d.cargo);
    if (d.message) lines.push(d.message);
    window.open(LK.waLink(lines.join("\n")), "_blank", "noopener");
  });
})();
