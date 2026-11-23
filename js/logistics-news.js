/* logistics-news.html — category tabs, search, featured story, paging, deadline countdown */
(function () {
  "use strict";
  var LK = window.LK;
  var $ = function (s) { return document.querySelector(s); };
  var all = [];
  var state = { cat: "all", q: "", shown: 12 };

  // -------------------------------------------------- URA monthly deadline (15th)
  (function deadline() {
    var now = new Date(); now.setHours(0, 0, 0, 0);
    var d = new Date(now.getFullYear(), now.getMonth(), 15);
    if (now > d) d = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    var days = Math.round((d - now) / 86400000);
    $("#deadlineDays").textContent = days === 0 ? "Today" : days + (days === 1 ? " day" : " days");
    $("#deadlineText").textContent = "VAT and PAYE returns for " +
      new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleString("en-GB", { month: "long" }) +
      " are due by " + d.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long" }) + ".";
  })();

  // -------------------------------------------------- rendering
  function cat(n) { return LK.NEWS_CATS[n.category] || LK.NEWS_CATS.trade; }

  function card(n) {
    var c = cat(n);
    return '<a class="lk-news-card" href="' + LK.esc(n.url) + '" target="_blank" rel="noopener">' +
      LK.newsThumb(n) +
      '<div class="body"><span class="lk-cat ' + LK.esc(n.category) + '"><i class="fa ' + c.icon + '"></i>' + c.label + "</span>" +
      "<h3>" + LK.esc(n.title) + "</h3>" + (n.summary ? "<p>" + LK.esc(n.summary) + "</p>" : "") +
      '<div class="lk-news-meta"><b>' + LK.esc(n.source || "") + "</b><span>·</span><span>" + LK.timeAgo(n.published_at) + "</span></div></div></a>";
  }
  function featured(n) {
    var c = cat(n);
    return '<a class="nh-featured" href="' + LK.esc(n.url) + '" target="_blank" rel="noopener">' +
      LK.newsThumb(n) +
      '<div class="body"><span class="lk-cat ' + LK.esc(n.category) + '"><i class="fa ' + c.icon + '"></i>' + c.label + " · Top story</span>" +
      "<h2>" + LK.esc(n.title) + "</h2>" + (n.summary ? "<p>" + LK.esc(n.summary) + "</p>" : "") +
      '<div class="lk-news-meta"><b>' + LK.esc(n.source || "") + "</b><span>·</span><span>" + LK.timeAgo(n.published_at) +
      '</span></div><span class="lk-btn lk-btn-teal lk-btn-sm" style="align-self:flex-start;margin-top:6px">Read story <i class="fa fa-external-link"></i></span></div></a>';
  }

  function renderTabs() {
    var counts = { all: all.length };
    all.forEach(function (n) { counts[n.category] = (counts[n.category] || 0) + 1; });
    var tabs = [["all", "All news", "fa-th-large"]].concat(Object.keys(LK.NEWS_CATS).map(function (k) { return [k, LK.NEWS_CATS[k].label, LK.NEWS_CATS[k].icon]; }));
    $("#tabs").innerHTML = tabs.map(function (t) {
      return '<button class="nh-tab' + (state.cat === t[0] ? " is-active" : "") + '" role="tab" aria-selected="' + (state.cat === t[0]) + '" data-cat="' + t[0] + '">' +
        '<i class="fa ' + t[2] + '"></i>' + t[1] + ' <span class="n">' + (counts[t[0]] || 0) + "</span></button>";
    }).join("");
  }

  function render() {
    var q = state.q.toLowerCase();
    var list = all.filter(function (n) {
      return (state.cat === "all" || n.category === state.cat) &&
        (!q || (n.title + " " + (n.summary || "") + " " + (n.source || "")).toLowerCase().indexOf(q) !== -1);
    });
    renderTabs();
    if (!list.length) {
      $("#featured").innerHTML = "";
      $("#grid").innerHTML = '<div class="lk-empty" style="grid-column:1/-1"><i class="fa fa-search"></i>' +
        (all.length ? "No stories match. Try another category or search." :
          LK.demo ? "Headlines will appear here once the backend is connected." : "No news collected yet. The feed refreshes every 2 hours.") + "</div>";
      $("#more").hidden = true;
      return;
    }
    // Prefer a story with an image as the featured one
    var fIdx = Math.max(0, list.slice(0, 5).findIndex(function (n) { return n.image_url; }));
    var f = list[fIdx];
    var rest = list.filter(function (_, i) { return i !== fIdx; });
    $("#featured").innerHTML = featured(f);
    $("#grid").innerHTML = rest.slice(0, state.shown).map(card).join("");
    $("#more").hidden = rest.length <= state.shown;
  }

  // -------------------------------------------------- events
  $("#tabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-cat]");
    if (!b) return;
    state.cat = b.getAttribute("data-cat");
    state.shown = 12;
    history.replaceState(null, "", state.cat === "all" ? location.pathname : "?cat=" + state.cat);
    render();
  });
  var t;
  $("#search").addEventListener("input", function (e) {
    clearTimeout(t);
    t = setTimeout(function () { state.q = e.target.value.trim(); state.shown = 12; render(); }, 150);
  });
  $("#more").addEventListener("click", function () { state.shown += 12; render(); });

  var initial = new URLSearchParams(location.search).get("cat");
  if (initial && LK.NEWS_CATS[initial]) state.cat = initial;

  // -------------------------------------------------- load + auto refresh
  function load() {
    return LK.api("/news?limit=100").then(function (data) {
      all = data.items || [];
      $("#refreshed").textContent = data.refreshedAt
        ? "Last updated " + LK.timeAgo(data.refreshedAt) + " · " + all.length + " stories from the last 60 days"
        : LK.demo ? "Preview mode: live feed not connected yet" : "Waiting for the first news refresh";
      render();
    }).catch(function (err) {
      $("#refreshed").textContent = "Couldn't refresh the news right now.";
      if (!all.length) {
        $("#grid").innerHTML = '<div class="lk-empty" style="grid-column:1/-1"><i class="fa fa-wifi"></i>' + LK.esc(err.message) + "</div>";
      }
    });
  }
  load();
  setInterval(load, 10 * 60 * 1000);
})();
