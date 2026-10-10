/// Dub Schedule — v2.0.0
/// Adds dubbed anime to Seanime's schedule page, with a filter/search bar on the
/// page itself, a tray menu for settings, and optional debug tools.

function init() {
    // Per-show dub summary built from the shared dub list, skipping shows the user
    // hid. { [mediaId]: { aired: highest aired dub ep, next: next upcoming dub item } }
    const dubIndex = () => {
        const items = $store.get("dub-schedule-items") || [];
        const hidden = ($store.get("dub-hidden-media") || []).map(Number);
        const now = Date.now();
        const idx = {};
        for (const i of items) {
            if (!i || hidden.indexOf(Number(i.mediaId)) > -1) continue;
            const t = new Date(i.dateTime).getTime();
            if (isNaN(t)) continue;
            const r = idx[i.mediaId] || (idx[i.mediaId] = { aired: 0, next: null });
            if (t <= now) { if (i.episodeNumber > r.aired) r.aired = i.episodeNumber; }
            else if (!r.next || t < new Date(r.next.dateTime).getTime()) r.next = i;
        }
        return idx;
    };

    // =====================================================================
    // UPCOMING EPISODES (home page): use the dub episode/time in dub modes
    // Seanime triggers this twice per request; the result is the same both times.
    // =====================================================================
    $app.onUpcomingEpisodes((e) => {
        try {
            const filter = $store.get("schedule-filter") || "all";
            const eps = (e.upcomingEpisodes && e.upcomingEpisodes.episodes) || [];
            if ((filter === "prefer-dub" || filter === "dub") && eps.length) {
                const idx = dubIndex();
                const nowS = Math.floor(Date.now() / 1000);
                for (const ep of eps) {
                    if (!ep) continue;
                    const r = idx[ep.mediaId];
                    if (!r || !r.next) continue;
                    const at = Math.floor(new Date(r.next.dateTime).getTime() / 1000);
                    if (ep.episodeNumber !== r.next.episodeNumber) ep.episodeMetadata = undefined; // was for the sub episode
                    ep.episodeNumber = r.next.episodeNumber;
                    ep.airingAt = at;
                    ep.timeUntilAiring = at - nowS;
                }
                const sorted = eps.slice().sort((a, b) => (a ? a.timeUntilAiring : 0) - (b ? b.timeUntilAiring : 0));
                e.upcomingEpisodes.episodes = sorted;
            }
        } catch (error) {
            console.error("Dub-Schedule Upcoming Hook Error:", error);
        } finally {
            e.next();
        }
    });

    // =====================================================================
    // CONTINUE WATCHING (streaming): optionally wait for the dub
    // Only for shows that are being dubbed right now (have an upcoming dub), so
    // finished or never-dubbed shows are never touched. Downloaded files always stay.
    // =====================================================================
    $app.onAnimeLibraryStreamCollection((e) => {
        try {
            const list = e.streamCollection && e.streamCollection.continueWatchingList;
            if ($store.get("dub-wait-cw") === true && list && list.length) {
                const idx = dubIndex();
                const kept = [];
                for (const ep of list) {
                    const id = ep && ep.baseAnime && ep.baseAnime.id;
                    const r = id ? idx[id] : null;
                    if (ep && !ep.isDownloaded && r && r.next && ep.episodeNumber > r.aired) continue;
                    kept.push(ep);
                }
                if (kept.length !== list.length) e.streamCollection.continueWatchingList = kept;
            }
        } catch (error) {
            console.error("Dub-Schedule Continue Watching Hook Error:", error);
        } finally {
            e.next();
        }
    });

    // =====================================================================
    // SCHEDULE HOOK
    // Runs in its own runtime: it can only talk to the UI side via $store.
    // =====================================================================
    $app.onAnimeScheduleItems((e) => {
        try {
            const dubFormat = $store.get("dub-format") || "icon";
            const dubPrefix = dubFormat === "bracket" ? "[DUB] " : dubFormat === "icon-only" ? "🎙️ - " : "🎙️Dub - ";
            const DUB_PREFIXES = ["🎙️Dub - ", "🎙️ - ", "[DUB] "];

            const filter = $store.get("schedule-filter") || "all";
            const search = String($store.get("dub-search") || "").trim().toLowerCase();
            const debugOn = !!$store.get("dub-debug-enabled");
            const debugItems = debugOn ? ($store.get("dub-debug-items") || []) : [];

            const matches = (title) => !search || String(title || "").toLowerCase().includes(search);

            // Dub items are stored without a prefix; the prefix and "(Delayed)" tag are
            // applied here at serve time so changing the format never needs a re-fetch.
            const decorate = (item, isDub) => {
                const { isDelayed, ...rest } = item;
                return { ...rest, title: `${isDub ? dubPrefix : ""}${item.title}${isDelayed ? " (Delayed)" : ""}` };
            };
            const fromDebug = (d) => ({
                mediaId: d.mediaId,
                title: d.title,
                time: d.time,
                dateTime: d.dateTime,
                image: d.image,
                episodeNumber: d.episodeNumber,
                isMovie: !!d.isMovie,
                isSeasonFinale: !!d.finale,
                isDelayed: !!d.delayed,
            });

            const subs = (e.items || [])
                .filter((i) => !DUB_PREFIXES.some((p) => (i.title || "").startsWith(p)))
                .filter((i) => matches(i.title));
            const hiddenIds = ($store.get("dub-hidden-media") || []).map(Number);
            const dubs = ($store.get("dub-schedule-items") || [])
                .filter((i) => hiddenIds.indexOf(Number(i.mediaId)) === -1)
                .filter((i) => matches(i.title))
                .map((i) => decorate(i, true));

            const merged = new Map();
            const put = (list, suffix) => list.forEach((i) => merged.set(`${i.mediaId}-${i.episodeNumber}${suffix}`, i));
            if (filter === "dub") put(dubs, "");
            else if (filter === "sub") put(subs, "");
            else if (filter === "prefer-dub") { put(subs, ""); put(dubs, ""); }
            else { put(subs, "-sub"); put(dubs, "-dub"); }

            let out = Array.from(merged.values());

            // Test entries from the debug tools are added on top, respecting the type filter.
            const dbg = debugItems.filter((d) => matches(d.title));
            if (filter !== "sub") out = out.concat(dbg.filter((d) => d.kind !== "sub").map((d) => decorate(fromDebug(d), true)));
            if (filter !== "dub") out = out.concat(dbg.filter((d) => d.kind === "sub").map((d) => decorate(fromDebug(d), false)));

            out.sort((a, b) => (a.dateTime ? new Date(a.dateTime).getTime() : 0) - (b.dateTime ? new Date(b.dateTime).getTime() : 0));
            e.items = out;
        } catch (error) {
            console.error("Dub-Schedule Hook Error:", error);
        } finally {
            e.next();
        }
    });

    // =====================================================================
    // UI
    // =====================================================================
    $ui.register(async (ctx) => {
        // =========================================================================
        // STYLES / MARKUP
        // =========================================================================
        const TRAY_CSS = `
        .ds-tray { display: flex; flex-direction: column; gap: 8px; }
        .ds-header { align-items: center; }
        .ds-logo { width: 34px !important; height: 34px !important; border-radius: 9px; object-fit: cover; }
        .ds-grow { flex: 1; min-width: 0; }
        .ds-title { font-size: 15px; font-weight: 700; line-height: 1.1; }
        .ds-status { font-size: 11px; opacity: .55; margin-top: 2px; }
        .ds-status.is-error, .ds-mono.is-error { color: #f87171; opacity: 1; }
        .ds-icon-btn { min-width: 32px; font-size: 15px; }
        .ds-card { padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); }
        .ds-kicker { font-size: 10px; letter-spacing: .08em; font-weight: 700; opacity: .45; }
        .ds-up { display: flex; flex-direction: column; gap: 8px; }
        .ds-up-row { align-items: center; }
        .ds-up-poster { width: 34px !important; height: 48px !important; min-width: 34px; border-radius: 6px; object-fit: cover; }
        .ds-up-title { font-size: 13px; font-weight: 600; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ds-up-meta { font-size: 11.5px; opacity: .6; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ds-up-open { min-width: 28px; font-size: 16px; }
        .ds-grow { flex: 1; min-width: 0; overflow: hidden; }
        .ds-next-row { align-items: baseline; justify-content: space-between; margin-top: 2px; }
        .ds-next-title { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
        .ds-next-title:hover { text-decoration: underline; text-underline-offset: 3px; }
        .ds-next-ep { font-size: 12px; opacity: .7; white-space: nowrap; }
        .ds-next-when { font-size: 11px; opacity: .55; margin-top: 2px; }
        .ds-label { font-size: 11px; font-weight: 600; opacity: .55; margin-top: 4px; }
        .ds-label-tight { margin-top: 0; }
        .ds-grid { display: grid !important; gap: 6px; }
        .ds-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ds-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .ds-seg { width: 100%; }
        .ds-full { width: 100%; }
        .ds-divider { height: 1px; background: rgba(255,255,255,.07); margin: 4px 0; }
        .ds-debug { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 10px; border: 1px dashed rgba(251,191,36,.35); background: rgba(251,191,36,.035); }
        .ds-row-between { align-items: center; justify-content: space-between; }
        .ds-test-list { display: flex; flex-direction: column; gap: 6px; }
        .ds-test-row { align-items: center; padding: 6px; border-radius: 8px; background: rgba(255,255,255,.035); }
        .ds-test-title { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ds-poster { width: 30px !important; height: 42px !important; min-width: 30px; border-radius: 5px; object-fit: cover; }
        .ds-poster-empty { display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.08); }
        .ds-poster-letter { font-weight: 700; opacity: .5; }
        .ds-muted { font-size: 11px; opacity: .55; }
        .ds-diag { display: flex; flex-direction: column; gap: 2px; padding: 8px; border-radius: 8px; background: rgba(0,0,0,.25); }
        .ds-stack-tight { display: flex; flex-direction: column; gap: 4px; }
.ds-help { margin-top: -2px; }
.ds-hidden-row { align-items: center; padding: 4px 6px; border-radius: 8px; background: rgba(255,255,255,.035); }
.ds-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; opacity: .75; }
        `;

        // The schedule bar runs in a sandboxed iframe. Plain JS only (no template
        // literals inside, since this whole page is itself a template literal).
        const BAR_HTML = `<!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="UTF-8">
        <style>
          html { color-scheme: dark; overflow: hidden; }
          :root { --b: #8ea2ff; --fg: #e8e8ee; --mut: rgba(232,232,238,.55); --line: rgba(255,255,255,.08); --chip: rgba(255,255,255,.045); }
          * { box-sizing: border-box; }
          body { margin: 0; padding: 0 0 14px; background: transparent; color: var(--fg); font: 13px/1.3 Inter, -apple-system, system-ui, "Segoe UI", sans-serif; }
          .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
          .seg { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--chip); border: 1px solid var(--line); }
          .seg button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 7px; font-weight: 600; font-size: 12.5px; color: var(--mut); transition: background .15s, color .15s; white-space: nowrap; }
          .seg button:hover { color: var(--fg); }
          .seg button.on { color: #fff; background: color-mix(in srgb, var(--b) 32%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--b) 55%, transparent); }
          .search { position: relative; flex: 1 1 220px; max-width: 340px; min-width: 180px; }
          .search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); opacity: .45; pointer-events: none; }
          .search input { width: 100%; height: 34px; padding: 0 30px 0 32px; border-radius: 10px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); font: inherit; outline: none; transition: border-color .15s; }
          .search input:focus { border-color: color-mix(in srgb, var(--b) 60%, transparent); }
          .search input::placeholder { color: var(--mut); }
          .clear { all: unset; cursor: pointer; position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; border-radius: 50%; text-align: center; line-height: 18px; font-size: 11px; color: var(--mut); display: none; }
          .clear:hover { background: var(--line); color: var(--fg); }
          .search.has .clear { display: block; }
          .info { display: flex; align-items: center; gap: 8px; margin-left: auto; min-width: 0; }
          .chip { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 10px; background: var(--chip); border: 1px solid var(--line); white-space: nowrap; min-width: 0; }
          .chip b { font-weight: 700; }
          .chip .mut { color: var(--mut); }
          .next { max-width: 360px; }
          .next .t { overflow: hidden; text-overflow: ellipsis; font-weight: 600; min-width: 0; }
          .ep { font-weight: 600; white-space: nowrap; flex: none; }
          .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--b); flex: none; }
          .warn { color: #fbbf24; border-color: rgba(251,191,36,.3); background: rgba(251,191,36,.06); }
          .refresh { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--chip); border: 1px solid var(--line); color: var(--mut); }
          .refresh:hover { color: var(--fg); }
          .refresh.spin svg { animation: spin .9s linear infinite; }
          .refresh.err { color: #f87171; }
          @keyframes spin { to { transform: rotate(360deg); } }
          .hide { display: none !important; }
          @media (max-width: 760px) { .info { margin-left: 0; width: 100%; } .next { flex: 1; max-width: none; } .search { max-width: none; } }
        </style>
        </head>
        <body>
        <div class="bar">
          <div class="seg" id="seg">
            <button data-f="all">All</button>
            <button data-f="prefer-dub">Prefer dubs</button>
            <button data-f="dub">Dubs</button>
            <button data-f="sub">Subs</button>
          </div>
          <label class="search" id="sw">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input id="q" type="text" placeholder="Search titles" autocomplete="off" spellcheck="false">
            <button class="clear" id="clr" title="Clear search">✕</button>
          </label>
          <div class="info">
            <span class="chip warn hide" id="dbg"></span>
            <span class="chip hide" id="week"></span>
            <span class="chip next hide" id="next"><span class="dot"></span><span class="t" id="nt"></span><span class="ep" id="ne"></span><span class="mut" id="nw"></span></span>
            <button class="refresh" id="ref" title="Refresh dub data">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
            </button>
          </div>
        </div>
        <script>
        (function () {
          var $ = function (id) { return document.getElementById(id); };
          var state = {};
          var timer = null;
          var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

          function send(ev, v) { if (window.webview) window.webview.send(ev, { v: v }); }
          function pad(n) { return (n < 10 ? "0" : "") + n; }
          function when(iso) {
            var d = new Date(iso), now = new Date();
            var mins = Math.round((d - now) / 60000);
            var hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
            if (mins >= 0 && mins < 60) return "in " + mins + "m";
            var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            var dd = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - t0) / 86400000);
            if (dd === 0) return "today " + hm;
            if (dd === 1) return "tomorrow " + hm;
            if (dd < 7) return DAYS[d.getDay()] + " " + hm;
            return d.getDate() + "/" + (d.getMonth() + 1) + " " + hm;
          }

          function render() {
            var s = state;
            if (s.theme) {
              var r = document.documentElement.style;
              if (s.theme.brand) r.setProperty("--b", s.theme.brand);
              if (s.theme.fg) r.setProperty("--fg", s.theme.fg);
            }
            var btns = $("seg").querySelectorAll("button");
            for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("on", btns[i].getAttribute("data-f") === (s.filter || "all"));

            var q = $("q");
            if (document.activeElement !== q && q.value !== (s.search || "")) q.value = s.search || "";
            $("sw").classList.toggle("has", !!q.value);

            var up = s.upcoming || [];
            var list = up; // counts and "next dub" always cover all your dubs, not just search matches
            var now = Date.now();
            var mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
            var sun = mon.getTime() + 7 * 86400000;
            var week = list.filter(function (x) { var t = new Date(x.d).getTime(); return t >= mon.getTime() && t < sun; }).length;
            var next = null;
            for (var j = 0; j < list.length; j++) { if (new Date(list[j].d).getTime() > now) { next = list[j]; break; } }

            var showDubInfo = s.filter !== "sub";
            $("week").classList.toggle("hide", !showDubInfo);
            $("week").innerHTML = "";
            var b = document.createElement("b"); b.textContent = String(week);
            var m = document.createElement("span"); m.className = "mut"; m.textContent = week === 1 ? "dub this week" : "dubs this week";
            $("week").appendChild(b); $("week").appendChild(m);

            $("next").classList.toggle("hide", !showDubInfo || !next);
            if (next) {
              $("nt").textContent = next.t;
              $("ne").textContent = "Ep " + next.e;
              $("nw").textContent = next.x ? "delayed · " + when(next.d) : when(next.d);
              $("next").title = "Next dub: " + next.t + " episode " + next.e;
            }

            $("dbg").classList.toggle("hide", !s.debug);
            $("dbg").textContent = s.debug ? (s.debug + " test " + (s.debug === 1 ? "entry" : "entries")) : "";
            $("dbg").title = "Test entries from Debug tools are on the schedule";

            var ref = $("ref");
            ref.classList.toggle("spin", s.phase === "loading");
            ref.classList.toggle("err", s.phase === "error");
            ref.title = s.phase === "error" ? "Couldn't update. Click to retry" : (s.lastUpdated ? "Updated " + when(s.lastUpdated).replace("in 0m", "just now") + ". Click to refresh" : "Refresh dub data");
          }

          $("seg").addEventListener("click", function (e) {
            var f = e.target && e.target.getAttribute && e.target.getAttribute("data-f");
            if (!f) return;
            state.filter = f; render(); send("filter", f);
          });
          $("q").addEventListener("input", function () {
            render();
            var v = this.value;
            clearTimeout(timer);
            timer = setTimeout(function () { send("search", v); }, 250);
          });
          $("q").addEventListener("keydown", function (e) { if (e.key === "Escape") { this.value = ""; render(); send("search", ""); } });
          $("clr").addEventListener("click", function (e) { e.preventDefault(); $("q").value = ""; render(); send("search", ""); $("q").focus(); });
          $("ref").addEventListener("click", function () { state.phase = "loading"; render(); send("refresh", true); });

          if (window.webview) window.webview.on("bar", function (d) { if (d) { state = d; render(); } });
          setInterval(render, 60000); // keep "in 12m" fresh
          render();
        })();
        </script>
        </body>
        </html>`;

        // Small dub info panel on the anime page. Plain JS only inside (no template literals).
        const ENTRY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  html { color-scheme: dark; overflow: hidden; }
  :root { --b: #8ea2ff; --fg: #e8e8ee; --mut: rgba(232,232,238,.55); --line: rgba(255,255,255,.08); --chip: rgba(255,255,255,.04); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2px 0 6px; background: transparent; color: var(--fg); font: 12.5px/1.3 Inter, -apple-system, system-ui, "Segoe UI", sans-serif; }
  .card { display: inline-flex; align-items: center; gap: 10px; max-width: 100%; padding: 5px 6px 5px 5px; border-radius: 999px; background: var(--chip); border: 1px solid var(--line); flex-wrap: wrap; }
  .ic { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--b) 20%, transparent); color: var(--b); flex: none; }
  .k { font-weight: 650; white-space: nowrap; }
  .v { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .v b { font-weight: 600; }
  .mut { color: var(--mut); }
  .sep { width: 1px; height: 14px; background: var(--line); flex: none; }
  .tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 650; line-height: 17px; }
  .delay { color: #fbbf24; background: rgba(251,191,36,.1); border: 1px solid rgba(251,191,36,.25); }
  .fin { color: #fcd34d; background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.25); }
  .prog { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .bar { width: 48px; height: 4px; border-radius: 99px; background: var(--line); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--b); border-radius: 99px; }
  button { all: unset; cursor: pointer; font-size: 11.5px; color: var(--mut); padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
  button:hover { color: var(--fg); background: var(--line); }
  .off .ic { background: var(--line); color: var(--mut); }
</style>
</head>
<body>
<div class="card" id="card">
  <div class="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/></svg></div>
  <span class="k" id="k">English dub</span>
  <span class="v" id="v"></span>
  <span class="sep" id="sp"></span>
  <span class="prog" id="prog"><span class="mut" id="pt"></span><span class="bar"><i id="pb"></i></span></span>
  <button id="tg"></button>
</div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var s = {};
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function when(iso) {
    var d = new Date(iso), now = new Date();
    var hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
    var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var dd = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - t0) / 86400000);
    var mins = Math.round((d - now) / 60000);
    var rel = mins < 60 ? "in " + Math.max(mins, 0) + "m" : mins < 1440 ? "in " + Math.round(mins / 60) + "h" : "in " + dd + " days";
    var day = dd === 0 ? "Today" : dd === 1 ? "Tomorrow" : DAYS[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1);
    return { day: day + " " + hm, rel: rel };
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function render() {
    if (s.theme && s.theme.brand) document.documentElement.style.setProperty("--b", s.theme.brand);
    var v = $("v"); v.innerHTML = "";
    $("card").classList.toggle("off", !!s.hidden);
    if (s.hidden) {
      $("k").textContent = "Dub";
      v.appendChild(el("span", "mut", "hidden for this show"));
      $("prog").style.display = "none"; $("sp").style.display = "none";
      $("tg").textContent = "Show";
      return;
    }
    $("tg").textContent = "Hide";
    if (s.next) {
      var w = when(s.next.d);
      $("k").textContent = "Dub";
      v.appendChild(el("b", "", "Ep " + s.next.e));
      v.appendChild(el("span", "mut", " · " + w.day + " (" + w.rel + ")"));
      if (s.next.x) v.appendChild(el("span", "tag delay", "Delayed"));
      if (s.next.f) v.appendChild(el("span", "tag fin", "Finale"));
    } else {
      $("k").textContent = "Dub";
      var done = s.total && s.aired >= s.total;
      v.appendChild(el("span", done ? "mut" : "", done ? "complete" : (s.aired ? "up to episode " + s.aired : "no episodes yet")));
    }
    var showProg = s.total > 0 && s.aired > 0 && s.aired <= s.total;
    $("prog").style.display = showProg ? "flex" : "none";
    $("sp").style.display = showProg ? "block" : "none";
    if (showProg) {
      $("pt").textContent = s.aired + "/" + s.total;
      $("pb").style.width = Math.min(100, Math.round(s.aired / s.total * 100)) + "%";
    }
  }
  $("tg").addEventListener("click", function () { if (window.webview) window.webview.send("toggle", { v: true }); });
  if (window.webview) window.webview.on("entry", function (d) { if (d) { s = d; render(); } });
  setInterval(render, 60000);
})();
</script>
</body>
</html>`;

        const SCHEDULE_QUERY_KEY = "ANIME-COLLECTION-get-anime-collection-schedule";
        const OTHER_QUERY_KEYS = ["ANIME-COLLECTION-get-library-collection", "ANIME-ENTRIES-get-upcoming-episodes", "ANIME-ENTRIES-get-anime-entry"];
        const SCHEDULE_URL = "https://raw.githubusercontent.com/RockinChaos/AniSchedule/refs/heads/master/raw/v2/dub-schedule.json";
        const FEED_URL = "https://raw.githubusercontent.com/RockinChaos/AniSchedule/refs/heads/master/raw/dub-episode-feed.json";
        const ICON_URL = "https://raw.githubusercontent.com/Bas1874/Dub-Schedule-Seanime/refs/heads/main/src/icons/icon.png";
        // Bump when the shape of saved dub items changes; old saved data is discarded.
        const CACHE_SCHEMA = "v2-1";
        const FILTERS = ["all", "prefer-dub", "dub", "sub"];
        const FORMATS = ["icon", "icon-only", "bracket"];

        const load = (key, fallback) => {
            const v = $storage.get(key);
            return v === undefined || v === null ? fallback : v;
        };

        // ---------------- helpers ----------------
        // Values from Go (AniList data) can be pointers (*string); a JSON round trip
        // turns them into plain JS values.
        const toPlain = (v) => { try { return v == null ? v : JSON.parse(JSON.stringify(v)); } catch (err) { return v; } };
        const pad = (n) => (n < 10 ? "0" : "") + n;
        const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const fmtWhen = (iso) => {
            const d = new Date(iso);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86400000);
            const day = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : `${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
            return `${day} ${fmtTime(d)}`;
        };
        const debounce = (key, fn, ms) => {
            if (ctx.jobs && typeof ctx.jobs.debounce === "function") { ctx.jobs.debounce(key, fn, ms); return; }
            // Fallback for older Seanime versions: only the latest call fires.
            debounceTokens[key] = (debounceTokens[key] || 0) + 1;
            const token = debounceTokens[key];
            ctx.setTimeout(() => { if (debounceTokens[key] === token) fn(); }, ms);
        };
        const debounceTokens = {};

        // ---------------- state ----------------
        if ($storage.get("dub-cache-schema") !== CACHE_SCHEMA) {
            $storage.set("dub-schedule-items", []);
            $storage.set("dub-cache-schema", CACHE_SCHEMA);
        }

        const filterState = ctx.state(FILTERS.includes(load("schedule-filter", "all")) ? load("schedule-filter", "all") : "all");
        const formatState = ctx.state(FORMATS.includes(load("dub-format", "icon")) ? load("dub-format", "icon") : "icon");
        const searchState = ctx.state(""); // not persisted: a forgotten search would look like an empty schedule
        const debugState = ctx.state(!!load("dub-debug-enabled", false));
        const debugItemsState = ctx.state(JSON.parse(JSON.stringify(load("dub-debug-items", []) || [])));
        const dubItemsState = ctx.state(load("dub-schedule-items", []));
        const statusState = ctx.state({ phase: "loading", lastUpdated: "", lastError: "", feedRows: 0, scheduleShows: 0, delayedIndef: 0 });
        const themeState = ctx.state({ brand: "#8ea2ff", card: "", fg: "", mut: "" });
        const barState = ctx.state({});
        const hiddenState = ctx.state((toPlain(load("dub-hidden-media", [])) || []).map(Number).filter((n) => n > 0));
        const waitCwState = ctx.state(load("dub-wait-cw", false) === true);
        const moveMissingState = ctx.state(load("dub-move-missing", true) !== false); // on by default
        const entryState = ctx.state({});

        $store.set("schedule-filter", filterState.get());
        $store.set("dub-format", formatState.get());
        $store.set("dub-search", "");
        $store.set("dub-debug-enabled", debugState.get());
        $store.set("dub-debug-items", debugItemsState.get());
        $store.set("dub-schedule-items", dubItemsState.get());
        $store.set("dub-hidden-media", hiddenState.get());
        $store.set("dub-wait-cw", waitCwState.get());

        // Dub items for shows the user hasn't hidden.
        const visibleDubs = () => { const h = hiddenState.get(); return dubItemsState.get().filter((i) => h.indexOf(Number(i.mediaId)) === -1); };

        let collectionMap = new Map(); // mediaId -> media, last loaded AniList collection
        let listInfo = new Map();      // mediaId -> { status, progress, title } for every list entry
        // Seanime's calendar only shows episodes of shows on your list with one of these statuses.
        const VISIBLE_STATUSES = ["PLANNING", "CURRENT", "COMPLETED", "PAUSED"];
        let fetchRetryCount = 0;
        const MAX_FETCH_RETRIES = 5;

        // ---------------- schedule rebuild ----------------
        // Clearing Seanime's schedule cache and refetching just the schedule query is
        // much cheaper than refreshing the whole AniList collection.
        const rebuildNow = () => {
            let cleared = false;
            try {
                if (ctx.anime && typeof ctx.anime.clearScheduleCache === "function") {
                    ctx.anime.clearScheduleCache();
                    cleared = true;
                }
            } catch (err) { console.error("Dub-Schedule: clearScheduleCache failed", err); }
            try { $app.invalidateClientQuery([SCHEDULE_QUERY_KEY]); } catch (err) { console.error(err); }
            if (!cleared) { try { $anilist.refreshAnimeCollection(); } catch (err) { console.error(err); } }
        };
        const queueRebuild = () => debounce("dub-rebuild", rebuildNow, 300);

        // Upcoming episodes and Continue Watching are cached by Seanime until the AniList
        // collection refreshes, so settings that affect them also trigger a (debounced)
        // collection refresh. Search and label format don't, so they stay instant.
        const refreshOtherScreens = () => {
            try { $app.invalidateClientQuery(OTHER_QUERY_KEYS); } catch (err) { }
            debounce("dub-collection-refresh", () => { try { $anilist.refreshAnimeCollection(); } catch (err) { console.error(err); } }, 1500);
        };

        // ---------------- page bar data ----------------
        const syncBar = () => {
            const now = Date.now();
            const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0);
            weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
            const horizon = now + 35 * 86400000;
            const dbgDubs = debugState.get() ? debugItemsState.get().filter((d) => d.kind !== "sub").map((d) => ({ title: d.title, episodeNumber: d.episodeNumber, dateTime: d.dateTime, isDelayed: d.delayed })) : [];
            const upcoming = visibleDubs().concat(dbgDubs)
                .filter((i) => { const t = new Date(i.dateTime).getTime(); return t >= weekStart.getTime() && t <= horizon; })
                .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
                .map((i) => ({ t: i.title, e: i.episodeNumber, d: i.dateTime, x: i.isDelayed ? 1 : 0 }));
            const st = statusState.get();
            barState.set({
                filter: filterState.get(),
                search: searchState.get(),
                phase: st.phase,
                lastUpdated: st.lastUpdated,
                upcoming,
                theme: themeState.get(),
                debug: debugState.get() && debugItemsState.get().length > 0 ? debugItemsState.get().length : 0,
            });
        };

        const updateBadge = () => {
            try {
                const n = debugState.get() ? debugItemsState.get().length : 0;
                tray.updateBadge(n > 0 ? { number: n, intent: "warning" } : { number: 0 });
            } catch (err) { }
        };

        // ---------------- setters ----------------
        const setFilter = (v) => {
            if (!FILTERS.includes(v) || filterState.get() === v) return;
            filterState.set(v);
            $storage.set("schedule-filter", v);
            $store.set("schedule-filter", v);
            syncBar();
            queueRebuild();
            refreshOtherScreens();
        };
        const setFormat = (v) => {
            if (!FORMATS.includes(v) || formatState.get() === v) return;
            formatState.set(v);
            $storage.set("dub-format", v);
            $store.set("dub-format", v);
            queueRebuild();
        };
        const setSearch = (v) => {
            const next = (typeof v === "string" ? v : "").slice(0, 100);
            if (searchState.get() === next) return;
            searchState.set(next);
            $store.set("dub-search", next);
            syncBar();
            queueRebuild();
        };
        const setDebug = (on) => {
            on = !!on;
            if (debugState.get() === on) return;
            debugState.set(on);
            $storage.set("dub-debug-enabled", on);
            $store.set("dub-debug-enabled", on);
            updateBadge();
            syncBar();
            if (debugItemsState.get().length) queueRebuild();
        };
        const saveDebugItems = (list) => {
            list = JSON.parse(JSON.stringify(list || []));
            debugItemsState.set(list);
            $storage.set("dub-debug-items", list);
            $store.set("dub-debug-items", list);
            updateBadge();
            syncBar();
            queueRebuild();
        };

        const setHidden = (mediaId, hide) => {
            mediaId = Number(mediaId);
            if (!mediaId) return;
            const cur = hiddenState.get();
            const next = hide ? (cur.indexOf(mediaId) > -1 ? cur : cur.concat([mediaId])) : cur.filter((x) => x !== mediaId);
            if (next === cur) return;
            hiddenState.set(next);
            $storage.set("dub-hidden-media", next);
            $store.set("dub-hidden-media", next);
            syncBar();
            syncEntry();
            queueRebuild();
            refreshOtherScreens();
        };
        const setWaitCw = (on) => {
            on = !!on;
            if (waitCwState.get() === on) return;
            waitCwState.set(on);
            $storage.set("dub-wait-cw", on);
            $store.set("dub-wait-cw", on);
            refreshOtherScreens();
        };
        const titleFor = (id) => {
            const i = listInfo.get(Number(id));
            if (i && i.title) return i.title;
            const d = dubItemsState.get().find((x) => Number(x.mediaId) === Number(id));
            return d ? d.title : `AniList ${id}`;
        };

        // ---------------- data fetching ----------------
        const scheduleRetry = () => {
            if (fetchRetryCount >= MAX_FETCH_RETRIES) {
                console.error(`Dub-Schedule: giving up after ${MAX_FETCH_RETRIES} failed attempts. Will try again on the 30-minute interval.`);
                ctx.toast.error("Dub Schedule: couldn't load dub data. Retrying automatically in 30 minutes.");
                statusState.set({ ...statusState.get(), phase: "error" });
                syncBar();
                return;
            }
            fetchRetryCount++;
            const delay = 5000 * fetchRetryCount;
            console.log(`Dub-Schedule: fetch failed, retrying in ${delay / 1000}s (attempt ${fetchRetryCount}/${MAX_FETCH_RETRIES})`);
            ctx.setTimeout(() => fetchAndProcessDubSchedule(false), delay);
        };

        const signature = (items) => items.map((i) => `${i.mediaId}~${i.episodeNumber}~${i.dateTime}~${i.isDelayed ? 1 : 0}~${i.title}`).join("|");

        const fetchAndProcessDubSchedule = async (force) => {
            statusState.set({ ...statusState.get(), phase: "loading" });
            syncBar();
            try {
                const scheduleRes = await ctx.fetch(SCHEDULE_URL);
                const feedRes = await ctx.fetch(FEED_URL);
                if (!scheduleRes.ok || !feedRes.ok) {
                    statusState.set({ ...statusState.get(), lastError: `HTTP ${scheduleRes.status} / ${feedRes.status}` });
                    scheduleRetry();
                    return;
                }
                const scheduleRaw = scheduleRes.json();
                const feedRaw = feedRes.json();
                const schedule = Array.isArray(scheduleRaw) ? scheduleRaw : [];
                const feed = Array.isArray(feedRaw) ? feedRaw : [];

                // v2 uses Unix SECONDS; the feed uses ISO strings.
                const toDate = (v) => (typeof v === "number" ? v * 1000 : v);

                // Past feed goes FIRST so an aired episode keeps its real aired date if it is
                // still listed in the schedule (first date wins during dedup).
                const airings = [];
                for (const item of feed) {
                    if (!item?.id || item?.episode?.aired == null || !item?.episode?.airedAt) continue;
                    airings.push({ mediaId: item.id, episodeNumber: item.episode.aired, episodeDate: toDate(item.episode.airedAt), isDelayed: false });
                }
                let delayedIndef = 0;
                for (const media of schedule) {
                    if (!media?.id) continue;
                    for (const node of (media?.airingSchedule?.nodes || [])) {
                        if (node?.delayedIndefinitely) { delayedIndef++; continue; }
                        if (node?.episode == null || !node?.airingAt) continue;
                        airings.push({ mediaId: media.id, episodeNumber: node.episode, episodeDate: toDate(node.airingAt), isDelayed: !!node.delayed });
                    }
                }

                // A forced refresh asks AniList for a fresh collection; otherwise the cached
                // one is used first (fast) with the fresh one as fallback.
                let collection = null;
                for (const fresh of (force ? [true, false] : [false, true])) {
                    try { collection = await $anilist.getAnimeCollection(fresh); } catch (err) { console.error("Dub-Schedule: collection fetch failed", err); }
                    if (collection) break;
                }
                if (!collection) { statusState.set({ ...statusState.get(), lastError: "AniList collection unavailable" }); scheduleRetry(); return; }

                // Lookup map of the user's list, skipping dropped shows.
                const map = new Map();
                const info = new Map();
                for (const list of (collection.MediaListCollection?.lists || [])) {
                    for (const entry of (list.entries || [])) {
                        if (!entry?.media?.id) continue;
                        const meta = toPlain({ status: entry.status, progress: entry.progress, title: entry.media.title?.userPreferred || entry.media.title?.romaji }) || {};
                        const status = String(meta.status || "");
                        if (!info.has(entry.media.id)) info.set(entry.media.id, { status, progress: Number(meta.progress || 0), title: String(meta.title || "") });
                        if (status === "DROPPED" || map.has(entry.media.id)) continue;
                        map.set(entry.media.id, entry.media);
                    }
                }
                collectionMap = map;
                listInfo = info;
                rehostDebugItems();

                const seen = new Set();
                const items = [];
                for (const a of airings) {
                    const key = `${a.mediaId}-${a.episodeNumber}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const anime = map.get(a.mediaId);
                    if (!anime) continue;
                    const date = new Date(a.episodeDate);
                    if (isNaN(date.getTime())) continue;
                    const total = anime.episodes ? parseInt($toString(anime.episodes)) : 0;
                    items.push({
                        mediaId: anime.id,
                        title: anime.title?.userPreferred || anime.title?.romaji || "Unknown",
                        time: fmtTime(date),
                        dateTime: date.toISOString(),
                        image: anime.coverImage?.large || anime.coverImage?.medium,
                        episodeNumber: a.episodeNumber,
                        isMovie: anime.format === "MOVIE",
                        isSeasonFinale: total > 0 && a.episodeNumber === total,
                        isDelayed: a.isDelayed,
                    });
                }

                const plainItems = JSON.parse(JSON.stringify(items));
                items.length = 0; plainItems.forEach((i) => items.push(i));
                const changed = signature(dubItemsState.get()) !== signature(items);
                dubItemsState.set(items);
                $store.set("dub-schedule-items", items);
                $storage.set("dub-schedule-items", items);
                fetchRetryCount = 0;
                statusState.set({ phase: "ok", lastUpdated: new Date().toISOString(), lastError: "", feedRows: feed.length, scheduleShows: schedule.length, delayedIndef });
                syncBar();
                // Only rebuild Seanime's schedule when something actually changed.
                syncEntry();
                if (changed || force) { queueRebuild(); if (changed) { try { $app.invalidateClientQuery(OTHER_QUERY_KEYS); } catch (err) { } } }
            } catch (error) {
                console.error("Dub-Schedule UI Error:", error);
                statusState.set({ ...statusState.get(), lastError: String(error) });
                scheduleRetry();
            }
        };

        const forceRefresh = async () => {
            fetchRetryCount = 0;
            ctx.toast.info("Dub Schedule: refreshing data...");
            await fetchAndProcessDubSchedule(true);
            if (statusState.get().phase === "ok") ctx.toast.success(`Dub Schedule: ${dubItemsState.get().length} dub episodes loaded.`);
        };

        // =================================================================
        // SCHEDULE PAGE BAR (official webview slot — no unsafe flags needed)
        // =================================================================
        let bar = null;
        try {
            bar = ctx.newWebview({ slot: "schedule-screen-top", fullWidth: true, autoHeight: true });
        } catch (err) {
            console.error("Dub-Schedule: schedule bar unavailable on this Seanime version", err);
        }
        if (bar) {
            bar.channel.sync("bar", barState);
            // Messages arrive wrapped as { v: value }; an empty string sent bare does not
            // survive the trip, so never trust the raw payload.
            const unwrap = (p) => (p && typeof p === "object" && "v" in p ? p.v : p);
            bar.channel.on("filter", (p) => setFilter(String(unwrap(p) || "")));
            bar.channel.on("search", (p) => { const v = unwrap(p); setSearch(typeof v === "string" ? v : ""); });
            bar.channel.on("refresh", () => forceRefresh());
            bar.setContent(() => BAR_HTML);
        }

        // =================================================================
        // ANIME PAGE: small dub info panel + "Hide dubs for this show" menu item
        // Shown only for shows that have dub data (or were hidden by the user).
        // =================================================================
        let currentEntryId = 0;
        let entryPanel = null;
        try {
            entryPanel = ctx.newWebview({ slot: "after-media-entry-details", fullWidth: true, autoHeight: true, hidden: true });
        } catch (err) {
            console.error("Dub-Schedule: anime page panel unavailable on this Seanime version", err);
        }
        let hideItem = null;
        let hideItemMounted = false;
        try {
            hideItem = ctx.action.newAnimePageDropdownItem({ label: "Hide dubs for this show" });
            hideItem.onClick((event) => {
                const media = toPlain(event && event.media) || {};
                const id = Number(media.id || currentEntryId);
                if (!id) return;
                const hide = hiddenState.get().indexOf(id) === -1;
                setHidden(id, hide);
                ctx.toast.success(hide ? `Dubs hidden for ${titleFor(id)}` : `Dubs shown again for ${titleFor(id)}`);
            });
        } catch (err) {
            console.error("Dub-Schedule: anime page menu item unavailable", err);
        }
        const setHideItem = (visible, hidden) => {
            if (!hideItem) return;
            try {
                if (visible) {
                    hideItem.setLabel(hidden ? "Show dubs for this show" : "Hide dubs for this show");
                    if (!hideItemMounted) { hideItem.mount(); hideItemMounted = true; }
                } else if (hideItemMounted) { hideItem.unmount(); hideItemMounted = false; }
            } catch (err) { console.error(err); }
        };

        function syncEntry() {
            const id = currentEntryId;
            const hidden = id > 0 && hiddenState.get().indexOf(id) > -1;
            const mine = id > 0 ? dubItemsState.get().filter((i) => Number(i.mediaId) === id) : [];
            const show = id > 0 && (hidden || mine.length > 0);
            setHideItem(show, hidden);
            if (!entryPanel) return;
            if (!show) { try { entryPanel.hide(); } catch (err) { } return; }
            const now = Date.now();
            let aired = 0, next = null;
            for (const i of mine) {
                const t = new Date(i.dateTime).getTime();
                if (t <= now) { if (i.episodeNumber > aired) aired = i.episodeNumber; }
                else if (!next || t < new Date(next.dateTime).getTime()) next = i;
            }
            const total = (() => { const m = collectionMap.get(id); const p = m ? toPlain({ e: m.episodes }) : null; return p && p.e ? Number(p.e) : 0; })();
            entryState.set({
                id, hidden, aired, total,
                next: next ? { e: next.episodeNumber, d: next.dateTime, x: next.isDelayed ? 1 : 0, f: next.isSeasonFinale ? 1 : 0 } : null,
                theme: themeState.get(),
            });
            try { entryPanel.show(); } catch (err) { }
        }

        if (entryPanel) {
            entryPanel.channel.sync("entry", entryState);
            entryPanel.channel.on("toggle", () => {
                if (!currentEntryId) return;
                setHidden(currentEntryId, hiddenState.get().indexOf(currentEntryId) === -1);
            });
            entryPanel.setContent(() => ENTRY_HTML);
        }
        try {
            ctx.screen.onNavigate((e) => {
                const nav = toPlain({ p: e && e.pathname, q: e && e.searchParams }) || {};
                currentEntryId = nav.p === "/entry" && nav.q && nav.q.id ? (parseInt(String(nav.q.id), 10) || 0) : 0;
                syncEntry();
                if (nav.p === "/schedule") { ctx.setTimeout(() => applyScheduleLayout(), 400); ctx.setTimeout(() => applyScheduleLayout(), 1500); }
            });
            ctx.screen.loadCurrent();
        } catch (err) { console.error("Dub-Schedule: navigation tracking unavailable", err); }

        // =================================================================
        // SCHEDULE PAGE LAYOUT: "Missing from your library" below the calendar
        // Elements are never moved (React owns them); only their visual order changes
        // via flex + CSS order on the page column, so Seanime keeps working normally.
        // =================================================================
        let layoutBusy = false;
        const findPageSections = async () => {
            const cal = await ctx.dom.queryOne("[data-schedule-calendar]");
            if (!cal) return null;
            let node = cal;
            let parent = await cal.getParent();
            for (let k = 0; k < 12 && parent; k++) {
                if (await parent.hasAttribute("data-page-wrapper")) break;
                node = parent;
                parent = await parent.getParent();
            }
            if (!parent || !(await parent.hasAttribute("data-page-wrapper"))) return null;
            node.setAttribute("data-ds-calendar-section", "1");
            const kids = await parent.getChildren();
            let calIdx = -1;
            for (let i = 0; i < kids.length; i++) {
                if (await kids[i].hasAttribute("data-ds-calendar-section")) { calIdx = i; break; }
            }
            return { wrapper: parent, kids, calIdx };
        };
        const applyScheduleLayout = async () => {
            if (layoutBusy) return;
            layoutBusy = true;
            try {
                const found = await findPageSections();
                if (!found || found.calIdx < 0) return;
                const { wrapper, kids, calIdx } = found;
                // The section rendered right before the calendar's is "Missing from your library"
                // (an AppLayoutStack); it isn't rendered at all when nothing is missing.
                let missingIdx = -1;
                if (calIdx > 0) {
                    const cls = String((await kids[calIdx - 1].getAttribute("class")) || "");
                    if (cls.indexOf("UI-AppLayoutStack__root") > -1) missingIdx = calIdx - 1;
                }
                if (!moveMissingState.get() || missingIdx < 0) {
                    if (await wrapper.hasAttribute("data-ds-reordered")) {
                        wrapper.removeStyle("display"); wrapper.removeStyle("flex-direction");
                        for (const k of kids) k.removeStyle("order");
                        wrapper.removeAttribute("data-ds-reordered");
                    }
                    return;
                }
                wrapper.setStyle("display", "flex");
                wrapper.setStyle("flex-direction", "column");
                for (let i = 0; i < kids.length; i++) {
                    kids[i].setStyle("order", String(i === missingIdx ? calIdx * 2 + 1 : i * 2));
                }
                wrapper.setAttribute("data-ds-reordered", "1");
            } catch (err) {
                console.error("Dub-Schedule: schedule layout failed", err);
            } finally {
                layoutBusy = false;
            }
        };
        try {
            // Runs whenever the calendar appears (every visit to the Schedule page).
            ctx.dom.observe("[data-schedule-calendar]", () => { applyScheduleLayout(); });
        } catch (err) { console.error("Dub-Schedule: layout observer unavailable", err); }
        const setMoveMissing = (on) => {
            on = !!on;
            if (moveMissingState.get() === on) return;
            moveMissingState.set(on);
            $storage.set("dub-move-missing", on);
            applyScheduleLayout();
        };

        // ---------------- theme (reads the user's Seanime accent colour) ----------------
        const normalizeColor = (v) => {
            if (!v) return "";
            v = String(v).trim().replace(/\s*\/\s*<alpha-value>\s*/g, "");
            if (!v || v === "none" || v === "transparent" || v === "rgba(0, 0, 0, 0)") return "";
            if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
            const fn = v.match(/^(rgba?|hsla?)\(([^)]*)\)$/i);
            const parts = (fn ? fn[2] : v).replace(/\s*\/\s*[\d.%]+\s*$/, "").split(/[\s,]+/).filter(Boolean);
            if (parts.length !== 3) return fn ? v : "";
            if (parts[1].indexOf("%") > -1 && parts[2].indexOf("%") > -1) return `hsl(${parts.join(", ")})`;
            if (parts.every((p) => /^-?[\d.]+$/.test(p))) return `rgb(${parts.join(", ")})`;
            return fn ? v : "";
        };
        const probeTheme = async () => {
            try {
                const body = await ctx.dom.queryOne("body");
                if (!body) return;
                const read = async (name) => { try { return normalizeColor(await body.getComputedStyle(name)); } catch (err) { return ""; } };
                let brand = "";
                for (const name of ["--brand-300", "--brand", "--brand-400", "--brand-500"]) { brand = await read(name); if (brand) break; }
                if (!brand) {
                    // Fallback: resolve a real Tailwind brand class on a throwaway element.
                    const probe = await ctx.dom.createElement("div");
                    try {
                        probe.setStyle("position", "absolute"); probe.setStyle("left", "-9999px");
                        body.append(probe);
                        const base = String((await probe.getComputedStyle("color")) || "");
                        for (const cls of ["text-brand-300", "text-brand-400", "text-brand"]) {
                            probe.setAttribute("class", cls);
                            const c = String((await probe.getComputedStyle("color")) || "");
                            if (c && c !== base) { brand = normalizeColor(c); if (brand) break; }
                        }
                    } finally { try { probe.remove(); } catch (err) { } }
                }
                themeState.set({
                    brand: brand || "#8ea2ff",
                    card: await read("--paper"),
                    fg: await read("--foreground"),
                    mut: await read("--muted"),
                });
                syncBar();
                if (currentEntryId) syncEntry();
            } catch (err) {
                console.error("Dub-Schedule: theme probe failed", err);
            }
        };
        try { ctx.dom.onReady(() => { probeTheme(); }); } catch (err) { }

        // =================================================================
        // TRAY
        // =================================================================
        const tray = ctx.newTray({
            tooltipText: "Dub Schedule",
            iconUrl: ICON_URL,
            withContent: true,
            width: "380px",
        });

        ["all", "prefer-dub", "dub", "sub"].forEach((f) => ctx.registerEventHandler(`ds-filter-${f}`, () => setFilter(f)));
        FORMATS.forEach((f) => ctx.registerEventHandler(`ds-format-${f}`, () => setFormat(f)));
        ctx.registerEventHandler("ds-refresh", () => forceRefresh());

        // Debug toggle
        const moveMissingRef = ctx.fieldRef(moveMissingState.get());
        moveMissingRef.onValueChange((v) => setMoveMissing(v));
        const waitCwRef = ctx.fieldRef(waitCwState.get());
        waitCwRef.onValueChange((v) => setWaitCw(v));
        const debugRef = ctx.fieldRef(debugState.get());
        debugRef.onValueChange((v) => setDebug(v));

        // Debug form
        const nextHour = new Date(); nextHour.setMinutes(0, 0, 0); nextHour.setHours(nextHour.getHours() + 1);
        const dbgSourceRef = ctx.fieldRef("anilist");
        const dbgSourceState = ctx.state("anilist");
        dbgSourceRef.onValueChange((v) => dbgSourceState.set(v === "custom" ? "custom" : "anilist"));
        const dbgIdRef = ctx.fieldRef("");
        const dbgTitleRef = ctx.fieldRef("");
        const dbgImageRef = ctx.fieldRef("");
        const dbgEpRef = ctx.fieldRef("1");
        const dbgDayRef = ctx.fieldRef("0");
        const dbgTimeRef = ctx.fieldRef(fmtTime(nextHour));
        const dbgKindRef = ctx.fieldRef("dub");
        const dbgFinaleRef = ctx.fieldRef(false);
        const dbgDelayedRef = ctx.fieldRef(false);
        let fakeIdCounter = 900000000 + Math.floor(Math.random() * 1000) * 100;

        // AniList objects come from Go with pointer fields (*string); a JSON round trip
        // turns them into plain JS values that tray components accept.
        const plain = toPlain;

        const isVisible = (id) => { const i = listInfo.get(id); return !!i && VISIBLE_STATUSES.includes(i.status); };
        // Pick a show from the user's list to "host" a test entry that Seanime would otherwise
        // hide (not on the list, or a custom entry). Prefer one where this episode isn't watched
        // yet, so it isn't greyed out and the finale flag still shows.
        const pickHost = (ep) => {
            let best = null;
            listInfo.forEach((i, id) => {
                if (!VISIBLE_STATUSES.includes(i.status)) return;
                const score = (i.progress < ep ? 0 : 1000) + (i.status === "PLANNING" ? 0 : 100) + i.progress;
                if (!best || score < best.score) best = { id, score };
            });
            return best ? best.id : 0;
        };
        // Give a test entry a visible host if it needs one. Returns the (possibly updated) item.
        const withHost = (item) => {
            const realId = item.realMediaId != null ? item.realMediaId : item.mediaId;
            if (isVisible(realId)) return { ...item, mediaId: realId, realMediaId: realId, hostTitle: "" };
            if (item.hostTitle && isVisible(item.mediaId)) return item;
            const host = pickHost(item.episodeNumber);
            if (!host) return { ...item, realMediaId: realId };
            return { ...item, mediaId: host, realMediaId: realId, hostTitle: listInfo.get(host).title || `AniList ${host}` };
        };
        function rehostDebugItems() {
            const list = debugItemsState.get();
            if (!list.length || !listInfo.size) return;
            const next = list.map(withHost);
            if (JSON.stringify(next) !== JSON.stringify(list)) saveDebugItems(next);
        }
        const lookupMedia = (id) => {
            if (collectionMap.has(id)) return plain(collectionMap.get(id));
            try { return plain($anilist.getAnime(id)); } catch (err) { console.error("Dub-Schedule: AniList lookup failed", err); return null; }
        };

        ctx.registerEventHandler("ds-dbg-add", () => {
            const source = dbgSourceState.get();
            let mediaId = 0, title = "", image = "", isMovie = false;
            if (source === "anilist") {
                const id = parseInt(String(dbgIdRef.current || "").trim(), 10);
                if (!id) { ctx.toast.error("Enter an AniList ID first."); return; }
                const m = lookupMedia(id);
                if (!m) { ctx.toast.error(`Couldn't find AniList ID ${id}.`); return; }
                mediaId = id;
                title = m.title?.userPreferred || m.title?.romaji || m.title?.english || `AniList ${id}`;
                image = m.coverImage?.large || m.coverImage?.extraLarge || m.coverImage?.medium || "";
                isMovie = m.format === "MOVIE";
            } else {
                title = String(dbgTitleRef.current || "").trim();
                if (!title) { ctx.toast.error("Enter a title first."); return; }
                image = String(dbgImageRef.current || "").trim();
                mediaId = ++fakeIdCounter; // fake ID so test entries never collide with each other
            }
            const ep = Math.max(1, parseInt(String(dbgEpRef.current || "1"), 10) || 1);
            const tm = /^(\d{1,2}):(\d{2})$/.exec(String(dbgTimeRef.current || "").trim());
            if (!tm || +tm[1] > 23 || +tm[2] > 59) { ctx.toast.error("Time must look like 18:30."); return; }
            const d = new Date(); d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + (parseInt(String(dbgDayRef.current || "0"), 10) || 0));
            d.setHours(+tm[1], +tm[2], 0, 0);
            let item = {
                id: `dbg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                kind: dbgKindRef.current === "sub" ? "sub" : "dub",
                mediaId, title: String(title), image: String(image || ""), isMovie,
                episodeNumber: ep,
                dateTime: d.toISOString(),
                time: fmtTime(d),
                finale: !!dbgFinaleRef.current,
                delayed: !!dbgDelayedRef.current,
            };
            if (!listInfo.size) { ctx.toast.error("Your AniList list hasn't loaded yet. Try again in a moment."); return; }
            item = withHost(item);
            if (!isVisible(item.mediaId)) { ctx.toast.error("No show on your list can host this test entry, so Seanime would hide it."); return; }
            saveDebugItems(debugItemsState.get().concat([item]));
            const watched = (listInfo.get(item.mediaId) || {}).progress >= ep;
            ctx.toast.success(`Test entry added: ${title} ep ${ep}` + (item.hostTitle ? ` (shown via ${item.hostTitle})` : ""));
            if (watched) ctx.toast.warning(`Episode ${ep} counts as watched on your list, so Seanime greys it out and hides the finale flag. Use a higher episode number to see it normally.`);
        });
        ctx.registerEventHandler("ds-dbg-clear", () => saveDebugItems([]));
        ctx.registerEventHandler("ds-dbg-rebuild", () => { rebuildNow(); ctx.toast.info("Schedule rebuilt."); });
        ctx.registerEventHandler("ds-dbg-clear-cache", () => {
            dubItemsState.set([]);
            $storage.set("dub-schedule-items", []);
            $store.set("dub-schedule-items", []);
            forceRefresh();
        });

        const toggleDebugField = (id, field) => {
            saveDebugItems(debugItemsState.get().map((d) => (d.id === id ? { ...d, [field]: !d[field] } : d)));
        };

        const seanimeVersion = (() => { try { return $app.getVersion(); } catch (err) { return "?"; } })();

        // Seanime's tray rejects empty text ("text is required"), and repeated render
        // errors stop the whole plugin. Never pass an empty string.
        const safe = (v, fallback) => { const s = v == null ? "" : String(v); return s.trim() ? s : (fallback || "—"); };

        tray.render(() => {
            try {
                return renderTray();
            } catch (err) {
                console.error("Dub-Schedule: tray render failed", err);
                return tray.stack([
                    tray.text("Dub Schedule"),
                    tray.text("The menu hit an error. The schedule itself still works.", { className: "ds-muted" }),
                    tray.button("↻ Refresh data", { intent: "gray-subtle", size: "sm", onClick: "ds-refresh" }),
                ]);
            }
        });

        function renderTray() {
            const filter = filterState.get();
            const format = formatState.get();
            const st = statusState.get();
            const items = visibleDubs();
            const now = Date.now();
            
            const statusText = st.phase === "loading" ? "Updating…"
                : st.phase === "error" ? "Couldn't update — showing saved data"
                : st.lastUpdated ? `Updated ${fmtTime(new Date(st.lastUpdated))}` : "";

            const seg = (label, value, current, event) => tray.button(label, {
                intent: current === value ? "primary" : "gray-subtle",
                size: "sm",
                className: "ds-seg",
                onClick: event,
            });

            const header = tray.flex({
                gap: 3,
                className: "ds-header",
                items: [
                    tray.img({ src: ICON_URL, alt: "", width: "34px", height: "34px", className: "ds-logo" }),
                    tray.div([
                        tray.text("Dub Schedule", { className: "ds-title" }),
                        tray.text(safe(statusText, "Starting…"), { className: `ds-status ${st.phase === "error" ? "is-error" : ""}` }),
                    ], { className: "ds-grow" }),
                    tray.button("↻", { intent: "gray-subtle", size: "sm", className: "ds-icon-btn", onClick: "ds-refresh" }),
                ],
            });

            // Next few dubs from your list, each with poster, title, episode and time.
            const upNext = items.filter((i) => new Date(i.dateTime).getTime() > now)
                .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
                .slice(0, 3);
            const nextCard = tray.div([
                tray.text("UP NEXT", { className: "ds-kicker" }),
                ...(upNext.length ? upNext.map((n, idx) => tray.flex({
                    gap: 3,
                    className: "ds-up-row",
                    items: [
                        n.image
                            ? tray.img({ src: String(n.image), alt: "", width: "34px", height: "48px", className: "ds-up-poster" })
                            : tray.div([], { className: "ds-up-poster ds-poster-empty" }),
                        tray.div([
                            tray.text(safe(n.title, "Unknown title"), { className: "ds-up-title" }),
                            tray.text(`Ep ${safe(n.episodeNumber, "?")} · ${fmtWhen(n.dateTime)}${n.isDelayed ? " · Delayed" : ""}`, { className: "ds-up-meta" }),
                        ], { className: "ds-grow" }),
                        tray.button("›", {
                            size: "sm",
                            intent: "gray-subtle",
                            className: "ds-up-open",
                            onClick: ctx.eventHandler(`ds-open-${idx}-${n.mediaId}`, () => { try { ctx.screen.navigateTo("/entry", { id: String(n.mediaId) }); } catch (err) { console.error(err); } }),
                        }),
                    ],
                })) : [tray.text("No upcoming dubs from your list.", { className: "ds-muted" })]),
            ], { className: "ds-card ds-up" });

            const children = [
                tray.css(TRAY_CSS),
                header,
                nextCard,
                tray.text("Show on schedule", { className: "ds-label" }),
                tray.div([
                    seg("All", "all", filter, "ds-filter-all"),
                    seg("Prefer dubs", "prefer-dub", filter, "ds-filter-prefer-dub"),
                    seg("Dubs only", "dub", filter, "ds-filter-dub"),
                    seg("Subs only", "sub", filter, "ds-filter-sub"),
                ], { className: "ds-grid ds-grid-2" }),
                tray.text("Dub label", { className: "ds-label" }),
                tray.div([
                    seg("🎙️Dub", "icon", format, "ds-format-icon"),
                    seg("🎙️", "icon-only", format, "ds-format-icon-only"),
                    seg("[DUB]", "bracket", format, "ds-format-bracket"),
                ], { className: "ds-grid ds-grid-3" }),
                tray.div([
                    tray.switch("Wait for dubs in Continue Watching", { fieldRef: waitCwRef }),
                    tray.switch("Missing episodes below the calendar", { fieldRef: moveMissingRef }),
                ], { className: "ds-stack-tight" }),
                // Always rendered (empty when nothing is hidden) so it keeps its position
                // in the tree: Seanime matches tray components by position.
                tray.div(hiddenState.get().length ? [
                    tray.text(`Dubs hidden for ${hiddenState.get().length} ${hiddenState.get().length === 1 ? "show" : "shows"}`, { className: "ds-label" }),
                    ...hiddenState.get().map((id) => tray.flex({
                        gap: 2,
                        className: "ds-hidden-row",
                        items: [
                            tray.text(safe(titleFor(id), `AniList ${id}`), { className: "ds-test-title ds-grow" }),
                            tray.button("Show", { size: "sm", intent: "gray-subtle", onClick: ctx.eventHandler(`ds-unhide-${id}`, () => setHidden(id, false)) }),
                        ],
                    })),
                ] : [], { className: "ds-stack-tight" }),
                tray.div([], { className: "ds-divider" }),
                tray.checkbox("Debug tools", { fieldRef: debugRef }),
            ];

            if (debugState.get()) {
                const isCustom = dbgSourceState.get() === "custom";
                const dayOptions = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 14].map((n) => ({
                    label: n === -1 ? "Yesterday" : n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`,
                    value: String(n),
                }));
                const dbgList = debugItemsState.get();

                children.push(tray.div([
                    tray.text("Add a test entry", { className: "ds-label ds-label-tight" }),
                    tray.select("Source", {
                        fieldRef: dbgSourceRef,
                        size: "sm",
                        options: [{ label: "AniList ID", value: "anilist" }, { label: "Custom (name + image)", value: "custom" }],
                    }),
                    // Both groups are always rendered and one is hidden with CSS. Swapping them
                    // in and out made Seanime reuse the inputs by position (an AniList ID could
                    // end up in the Title box).
                    tray.div([
                        tray.input("AniList ID", { fieldRef: dbgIdRef, placeholder: "e.g. 21 (works for shows not on your list too)", size: "sm" }),
                    ], { className: "ds-stack-tight", style: { display: isCustom ? "none" : "flex" } }),
                    tray.div([
                        tray.input("Title", { fieldRef: dbgTitleRef, placeholder: "My Test Anime", size: "sm" }),
                        tray.input("Image URL", { fieldRef: dbgImageRef, placeholder: "https://… (optional)", size: "sm" }),
                    ], { className: "ds-stack-tight", style: { display: isCustom ? "flex" : "none" } }),
                    tray.div([
                        tray.input("Episode", { fieldRef: dbgEpRef, size: "sm" }),
                        tray.select("Day", { fieldRef: dbgDayRef, size: "sm", options: dayOptions }),
                        tray.input("Time", { fieldRef: dbgTimeRef, placeholder: "18:30", size: "sm" }),
                    ], { className: "ds-grid ds-grid-3" }),
                    tray.select("Type", { fieldRef: dbgKindRef, size: "sm", options: [{ label: "Dub", value: "dub" }, { label: "Sub", value: "sub" }] }),
                    tray.flex({
                        gap: 4,
                        items: [
                            tray.checkbox("Finale", { fieldRef: dbgFinaleRef }),
                            tray.checkbox("Delayed", { fieldRef: dbgDelayedRef }),
                        ],
                    }),
                    tray.button("+ Add to schedule", { intent: "primary", size: "sm", onClick: "ds-dbg-add", className: "ds-full" }),

                    dbgList.length
                        ? tray.div([
                            tray.flex({
                                gap: 2,
                                className: "ds-row-between",
                                items: [
                                    tray.text(`Test entries (${dbgList.length})`, { className: "ds-label ds-label-tight" }),
                                    tray.button("Remove all", { intent: "alert-subtle", size: "sm", onClick: "ds-dbg-clear" }),
                                ],
                            }),
                            ...dbgList.map((d) => tray.flex({
                                gap: 2,
                                className: "ds-test-row",
                                items: [
                                    d.image
                                        ? tray.img({ src: String(d.image), alt: "", width: "30px", height: "42px", className: "ds-poster" })
                                        : tray.div([tray.text("?", { className: "ds-poster-letter" })], { className: "ds-poster ds-poster-empty" }),
                                    tray.div([
                                        tray.text(safe(d.title, "Untitled"), { className: "ds-test-title" }),
                                        tray.text(`${d.kind === "sub" ? "Sub" : "Dub"} · Ep ${d.episodeNumber} · ${fmtWhen(d.dateTime)}`, { className: "ds-muted" }),
                                        tray.div(d.hostTitle ? [tray.text(`Link opens: ${d.hostTitle}`, { className: "ds-muted" })] : []),
                                    ], { className: "ds-grow" }),
                                    tray.button("Finale", { size: "sm", intent: d.finale ? "warning" : "gray-subtle", onClick: ctx.eventHandler(`ds-dbg-fin-${d.id}`, () => toggleDebugField(d.id, "finale")) }),
                                    tray.button("Delayed", { size: "sm", intent: d.delayed ? "warning" : "gray-subtle", onClick: ctx.eventHandler(`ds-dbg-del-${d.id}`, () => toggleDebugField(d.id, "delayed")) }),
                                    tray.button("✕", { size: "sm", intent: "gray-subtle", onClick: ctx.eventHandler(`ds-dbg-rm-${d.id}`, () => saveDebugItems(debugItemsState.get().filter((x) => x.id !== d.id))) }),
                                ],
                            })),
                        ], { className: "ds-test-list" })
                        : tray.div([tray.text("No test entries. They only show while Debug tools is on.", { className: "ds-muted" })], { className: "ds-test-list" }),

                    tray.div([], { className: "ds-divider" }),
                    tray.text("Diagnostics", { className: "ds-label ds-label-tight" }),
                    tray.div([
                        tray.text(`${seanimeVersion !== "?" ? `Seanime ${seanimeVersion} · ` : ""}schedule bar ${bar ? "on" : "unavailable"} · anime page panel ${entryPanel ? "on" : "unavailable"}`, { className: "ds-mono" }),
                        tray.text(`Source: ${st.scheduleShows} shows in v2 schedule, ${st.feedRows} feed rows`, { className: "ds-mono" }),
                        tray.text(`On your list: ${items.length} dub episodes (${items.filter((i) => new Date(i.dateTime).getTime() > now).length} upcoming, ${items.filter((i) => i.isDelayed).length} delayed)`, { className: "ds-mono" }),
                        tray.text(`Skipped (on indefinite break): ${st.delayedIndef}`, { className: "ds-mono" }),
                        tray.text(`Last update: ${st.lastUpdated ? fmtWhen(st.lastUpdated) : "never"}`, { className: "ds-mono" }),
                        tray.div(st.lastError ? [tray.text(`Last error: ${st.lastError}`, { className: "ds-mono is-error" })] : []),
                        tray.text(`Hidden shows: ${hiddenState.get().length} · Wait for dubs in Continue Watching: ${waitCwState.get() ? "on" : "off"}`, { className: "ds-mono" }),
                    ], { className: "ds-diag" }),
                    tray.div([
                        tray.button("Rebuild schedule", { intent: "gray-subtle", size: "sm", onClick: "ds-dbg-rebuild" }),
                        tray.button("Clear saved data", { intent: "gray-subtle", size: "sm", onClick: "ds-dbg-clear-cache" }),
                    ], { className: "ds-grid ds-grid-2" }),
                ], { className: "ds-debug" }));
            }

            return tray.div(children, { className: "ds-tray" });
        }

        // =================================================================
        // START
        // =================================================================
        updateBadge();
        syncBar();
        if (dubItemsState.get().length > 0) queueRebuild(); // show saved data right away
        fetchAndProcessDubSchedule(false);
        ctx.setInterval(() => fetchAndProcessDubSchedule(false), 30 * 60 * 1000);
    });
}
