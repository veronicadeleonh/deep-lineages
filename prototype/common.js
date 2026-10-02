/* Shared code: data loading, state, tooltip, paleomap and family panel.
   The timeline (app.js) calls boot(timeline); a timeline exposes init(), render(), update() and goTo(t). */

const DATA = "../data/processed/";
const DEFAULT_TIMES = [250, 240, 230, 220, 210, 200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70, 66];
const EXTINCTIONS = [
  { ma: 201.4, label: "End-Triassic extinction", short: "T–J" },
  { ma: 66, label: "K–Pg extinction", short: "K–Pg" },
];
const DIET = {
  herbivore: { label: "Herbivore", color: "var(--herb)" },
  carnivore: { label: "Carnivore", color: "var(--carn)" },
  omnivore: { label: "Omnivore", color: "var(--unknown)" },
  null: { label: "No data", color: "var(--unknown)" },
};
// Main lineages (Brusatte: saurischians = theropods + sauropodomorphs; ornithischians)
const GROUPS = [
  { key: "theropoda", label: "Theropods", short: "Ther.", clade: "Saurischians", hint: "bipedal meat-eaters" },
  { key: "sauropodomorpha", label: "Sauropodomorphs", short: "Saur.", clade: "Saurischians", hint: "long-necked giants" },
  { key: "ornithischia", label: "Ornithischians", short: "Orn.", clade: "Ornithischians", hint: "beaked plant-eaters" },
];
const LINEAGE = {
  Herrerasauridae: { group: "theropoda", disputed: "Debated position: sometimes placed as early saurischians, outside theropods." },
  Coelophysidae: { group: "theropoda" }, Megalosauridae: { group: "theropoda" }, Metriacanthosauridae: { group: "theropoda" },
  Carcharodontosauridae: { group: "theropoda" }, Dromaeosauridae: { group: "theropoda" }, Tyrannosauridae: { group: "theropoda" },
  Plateosauridae: { group: "sauropodomorpha" }, Massospondylidae: { group: "sauropodomorpha" }, Mamenchisauridae: { group: "sauropodomorpha" },
  Camarasauridae: { group: "sauropodomorpha" }, Brachiosauridae: { group: "sauropodomorpha" }, Diplodocidae: { group: "sauropodomorpha" },
  Silesauridae: { group: "ornithischia", disputed: "Debated position: possibly close relatives of dinosaurs rather than dinosaurs; some studies place them at the base of the ornithischians." },
  Heterodontosauridae: { group: "ornithischia" }, Scelidosauridae: { group: "ornithischia" }, Stegosauridae: { group: "ornithischia" },
  Nodosauridae: { group: "ornithischia" }, Tenontosauridae: { group: "ornithischia" }, Hadrosauridae: { group: "ornithischia" },
  Ceratopsidae: { group: "ornithischia" },
};
// Lineage comes from families.json (PBDB); LINEAGE is a fallback and holds the notes.
const groupOf = (f) => GROUPS.find((g) => g.key === (f.lineage || LINEAGE[f.family]?.group));

const fmt = d3.formatLocale({ decimal: ".", thousands: ",", grouping: [3], currency: ["$", ""] });
const fNum = fmt.format(",d");
const fMa = (v) => fmt.format(v % 1 ? ",.1f" : ",d")(v);
const longPeriod = (s) => s;
const dietOf = (f) => DIET[f.pbdb?.diet] || DIET.null;

const state = { t: 150, selected: null, snap: null };
let timeline;
let families, fossils, diversity, periods, paleoIndex, genera, stages;
const coastCache = new Map();
const locsCache = new Map();

/* ---------- loading ---------- */
async function getJSON(path, optional = false) {
  try {
    const r = await fetch(DATA + path);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (optional) return null;
    throw new Error(`Could not load ${path}: ${e.message}`);
  }
}

async function boot(view, { t = 150 } = {}) {
  timeline = view;
  state.t = t;
  [families, fossils, diversity, periods, paleoIndex, genera] = await Promise.all([
    getJSON("families.json"), getJSON("fossils.json"), getJSON("diversity.json"),
    getJSON("periods.json"), getJSON("paleomap/index.json", true), getJSON("genera.json", true),
  ]);
  genera = genera || {};
  stages = (await getJSON("stages.json", true)) || [];
  families.sort((a, b) => b.range_ma[0] - a.range_ma[0] || b.range_ma[1] - a.range_ma[1]);

  const c = fossils.columns;
  const idx = Object.fromEntries(c.map((k, i) => [k, i]));
  fossils = fossils.rows.map((r) => ({
    genus: r[idx.genus], family: r[idx.family],
    mid: (r[idx.max_ma] + r[idx.min_ma]) / 2, loc: r[idx.loc_id],
    pbdb: r[idx.pbdb_paleolng] == null ? null : [r[idx.pbdb_paleolng], r[idx.pbdb_paleolat]],
  }));
  const times = paleoIndex?.times || DEFAULT_TIMES;
  const nearest = (m) => times.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
  fossils.forEach((f) => (f.snap = nearest(f.mid)));
  state.times = times;
  state.nearest = nearest;

  renderLegend();
  map.init();
  timeline.init();
  setTime(state.t);
  let w = 0;
  new ResizeObserver(() => {
    const nw = document.documentElement.clientWidth;
    if (nw === w) return; // width changes only (on mobile the browser bar changes the height while scrolling)
    w = nw; timeline.render(); map.resize();
  }).observe(document.body);
}

/* ---------- state ---------- */
function setTime(t) {
  state.t = Math.round(Math.max(66, Math.min(252, t)) * 10) / 10;
  const p = periods.find((p) => state.t <= p.start && state.t >= p.end);
  document.getElementById("readout").innerHTML =
    `${fMa(state.t)} Ma <span class="period">· ${p ? longPeriod(p.name) : ""}</span>`;
  timeline.update();
  const snap = state.nearest(state.t);
  if (snap !== state.snap) { state.snap = snap; map.update(); }
  if (!state.selected) detail.render();
  else detail.updateAlive();
}

function select(name) {
  state.selected = state.selected === name ? null : name;
  state.genus = null;
  const f = families.find((d) => d.family === state.selected);
  if (f && !alive(f)) {
    const mid = (f.range_ma[0] + f.range_ma[1]) / 2;
    timeline.goTo ? timeline.goTo(mid) : setTime(mid);
  }
  timeline.update(); map.update(); detail.render();
}

function selectGenus(name) {
  state.genus = state.genus === name ? null : name;
  const g = genera[state.selected]?.genera.find((x) => x.genus === state.genus);
  if (g && !(state.t <= g.range_ma[0] && state.t >= g.range_ma[1])) {
    const mid = (g.range_ma[0] + g.range_ma[1]) / 2;
    timeline.goTo ? timeline.goTo(mid) : setTime(mid);
  }
  map.update(); detail.updateAlive(); timeline.update();
}

const alive = (f, t = state.t) => t <= f.range_ma[0] && t >= f.range_ma[1];

/* ---------- tooltip ---------- */
const tip = document.getElementById("tooltip");
function showTip(html, ev) {
  tip.innerHTML = html; tip.hidden = false;
  const { innerWidth: W } = window;
  const x = Math.min(ev.clientX + 14, W - tip.offsetWidth - 8);
  tip.style.left = `${x}px`; tip.style.top = `${ev.clientY + 14}px`;
}
const hideTip = () => (tip.hidden = true);

function renderLegend() {
  const used = [...new Set(families.map((f) => dietOf(f).label))];
  const el = document.getElementById("legend");
  if (!el) return;
  el.innerHTML = Object.values(DIET)
    .filter((d, i, a) => used.includes(d.label) && a.findIndex((x) => x.label === d.label) === i)
    .map((d) => `<li><i style="background:${d.color}"></i>${d.label}</li>`).join("");
}

/* ---------- paleomap ---------- */
const map = (() => {
  const el = document.getElementById("map");
  let svg, proj, path, gLand, gDots, W = 480, H = 260;

  function rewind(fc) {
    // d3 expects clockwise outer rings; if a polygon "covers the whole world", it is reversed.
    // Rings with <4 vertices break d3: they are dropped (the whole polygon if it is the outer ring).
    const valid = (rings) => (rings?.[0]?.length >= 4 ? rings.filter((r) => r.length >= 4) : null);
    const fix = (rings) => (d3.geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI ? rings.map((r) => r.slice().reverse()) : rings);
    fc.features = fc.features.filter((f) => {
      const g = f.geometry; if (!g) return false;
      if (g.type === "Polygon") { const r = valid(g.coordinates); if (!r) return false; g.coordinates = fix(r); }
      if (g.type === "MultiPolygon") { g.coordinates = g.coordinates.map(valid).filter(Boolean).map(fix); if (!g.coordinates.length) return false; }
      return true;
    });
    return fc;
  }

  function init() {
    svg = d3.select(el).append("svg");
    svg.append("path").attr("class", "sphere");
    svg.append("path").attr("class", "graticule");
    gLand = svg.append("g");
    gDots = svg.append("g");
    resize();
  }

  function resize() {
    W = el.clientWidth || 480; H = Math.round(W * 0.52);
    proj = d3.geoEqualEarth().fitExtent([[4, 4], [W - 4, H - 4]], { type: "Sphere" });
    path = d3.geoPath(proj);
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    svg.select(".sphere").attr("d", path({ type: "Sphere" }));
    svg.select(".graticule").attr("d", path(d3.geoGraticule10()));
    draw();
  }

  async function update() {
    const t = state.snap;
    const fileOK = paleoIndex?.times?.includes(t);
    if (fileOK && !coastCache.has(t)) {
      const [coast, locs] = await Promise.all([getJSON(`paleomap/coastlines_${t}.json`, true), getJSON(`paleomap/locs_${t}.json`, true)]);
      coastCache.set(t, coast ? rewind(coast) : null);
      locsCache.set(t, locs);
    }
    if (t !== state.snap) return; // the user has already moved on
    draw();
  }

  function draw() {
    if (!path || state.snap == null) return;
    const t = state.snap;
    const coast = coastCache.get(t);
    const locs = locsCache.get(t);
    const lines = coast?.features?.[0]?.geometry?.type?.includes("Line");
    gLand.selectAll("path").data(coast ? coast.features : []).join("path")
      .attr("class", lines ? "land lines" : "land").attr("d", path);

    const pts = fossils.filter((f) => f.snap === t)
      .map((f) => ({ ...f, xy: locs ? locs[f.loc] : f.pbdb }))
      .filter((f) => f.xy);
    const sel = state.selected, gen = state.genus;
    const isSel = gen ? (d) => d.genus === gen : (d) => sel != null && d.family === sel;
    const label = gen ? `<i>${gen}</i>` : sel;
    const selFam = families.find((d) => d.family === sel);
    pts.sort((a, b) => isSel(a) - isSel(b));
    gDots.selectAll("circle").data(pts).join("circle")
      .attr("class", (d) => (isSel(d) ? "dot hi" : "dot"))
      .attr("r", (d) => (isSel(d) ? 4.5 : 2.2))
      .style("fill", (d) => (isSel(d) ? dietOf(selFam).color : null))
      .attr("transform", (d) => { const p = proj(d.xy); return p ? `translate(${p})` : null; })
      .on("pointermove", (ev, d) => showTip(`<b>${d.genus}</b><br><span>${d.family || "unassigned family"} · ${fMa(Math.round(d.mid * 10) / 10)} Ma</span>`, ev))
      .on("pointerleave", hideTip);

    const lo = t + 5, hi = Math.max(66, t - 5);
    document.getElementById("map-title").textContent = `The world ${t} million years ago`;
    const nSel = sel ? pts.filter(isSel).length : 0;
    document.getElementById("map-count").textContent =
      `${fNum(pts.length)} fossils · ${lo}–${hi} Ma` + (sel ? ` · ${fNum(nSel)} ${gen || sel}` : "");
    const what = `Each dot is a fossil from ${lo}–${hi} Ma, placed where that spot was at the time${sel ? `; in color, ${gen || sel}` : ""}.`;
    document.getElementById("map-note").textContent = coast
      ? `${what} Continents: present-day coastlines moved to their position ${t} Ma ago (${paleoIndex.model} model, GPlates); inland seas of the time are not shown.`
      : `${what} No paleomap yet: run scripts/build_paleomaps.py.`;
  }

  return { init, resize, update };
})();

/* ---------- family panel ---------- */
const detail = (() => {
  const el = document.getElementById("detail");

  const chip = (f) => `<button class="chip" data-family="${f.family}"><i style="background:${dietOf(f).color}"></i>${f.family}</button>`;

  function empty() {
    const living = families.filter((f) => alive(f));
    const W = 5; // ±5 Ma window for "what is happening now"
    const born = families.filter((f) => Math.abs(f.range_ma[0] - state.t) <= W);
    const gone = families.filter((f) => Math.abs(f.range_ma[1] - state.t) <= W && f.range_ma[1] > 66);
    const events = [
      born.length && `<p class="event"><b>Appearing</b> ${born.map((f) => f.family).join(", ")}</p>`,
      gone.length && `<p class="event"><b>Disappearing</b> ${gone.map((f) => f.family).join(", ")}</p>`,
    ].filter(Boolean).join("");
    el.className = "detail-empty";
    el.innerHTML = `
      <h3>${living.length ? `${living.length} ${living.length === 1 ? "family" : "families"} alive` : "None of these families alive"}</h3>
      <p>${living.length ? "Pick one to see its profile and its fossils on the map." : "Move through time or pick a family on the timeline."}</p>
      ${events}
      <div class="chips">${(living.length ? living : families).map(chip).join("")}</div>`;
  }

  function full(f) {
    const w = f.wikipedia || {}, p = f.pbdb || {}, ph = f.phylopic;
    const lic = (url) => {
      if (!url) return "";
      const m = url.match(/licenses\/([^/]+)\/([\d.]+)/);
      return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : url.includes("zero") ? "CC0" : "license";
    };
    const cont = Object.keys(f.continents).sort((a, b) => f.continents[b] - f.continents[a]).map((c) => `${c} ${fNum(f.continents[c])}`).join(" · ");
    const gs = genera[f.family]?.genera || [];
    el.className = "detail";
    el.innerHTML = `
      <div class="detail-head">
        <div>
          <h3>${f.family}</h3>
          <p class="sub">${[groupOf(f)?.label, p.taxon_attr, p.parent_name && `within ${p.parent_name}`].filter(Boolean).join(" · ")}</p>
        </div>
        <button class="close" aria-label="Close">✕</button>
      </div>
      ${ph?.svg ? `<div class="silhouette" style="--src:url('${DATA}${ph.svg}')" role="img" aria-label="Silhouette of ${f.family}"></div>`
        : `<div class="no-sil">No PhyloPic silhouette</div>`}
      <dl class="stats">
        <div class="stat"><dt>Range</dt><dd>${fMa(f.range_ma[0])}–${fMa(f.range_ma[1])} Ma</dd></div>
        <div class="stat"><dt>Genera · fossils</dt><dd>${fNum(f.n_genera)} · ${fNum(f.n_occurrences)}</dd></div>
        <div class="stat"><dt>Diet</dt><dd class="diet"><i style="background:${dietOf(f).color}"></i>${dietOf(f).label}</dd></div>
      </dl>
      ${LINEAGE[f.family]?.disputed ? `<p class="meta disputed">${LINEAGE[f.family].disputed}</p>` : ""}
      ${w.extract ? `<p class="extract">${w.extract} <a href="${w.url}" target="_blank" rel="noopener">Wikipedia →</a></p>` : ""}
      ${pathHTML(f)}
      <p class="meta"><b>Fossils by continent:</b> ${cont}</p>
      ${earliestHTML(f)}
      ${p.life_habit || p.motility ? `<p class="meta"><b>Lifestyle:</b> ${[p.life_habit, p.motility].filter(Boolean).join(", ")}</p>` : ""}
      ${gs.length ? `<p class="meta"><b>Genera (${fNum(gs.length)})</b> <span class="muted">· unfolded on the timeline; click one to see it on the map</span></p>` : ""}
      <p class="credits">
        ${ph ? `Silhouette${ph.source && ph.source !== f.family ? ` of <i>${ph.source}</i>` : ""}: ${ph.attribution || "unknown author"} · <a href="${ph.license}" target="_blank" rel="noopener">${lic(ph.license)}</a> · <a href="${ph.page}" target="_blank" rel="noopener">PhyloPic</a><br>` : ""}
        ${w.extract ? `Text: Wikipedia (${w.lang}) · CC BY-SA 4.0 · ` : ""}Data: Paleobiology Database · CC BY 4.0
      </p>`;
  }

  /* ancestry: from archosaurs down to the family (PBDB, rel=all_parents) */
  const COMMON = { Archosauria: "archosaurs", Dinosauria: "dinosaurs", Saurischia: "saurischians", Theropoda: "theropods",
    Sauropodomorpha: "sauropodomorphs", Ornithischia: "ornithischians", Avemetatarsalia: "bird-line archosaurs" };
  function pathHTML(f) {
    const path = genera[f.family]?.path;
    if (!path?.length) return "";
    const key = new Set(["Dinosauria", "Theropoda", "Sauropodomorpha", "Ornithischia"]);
    return `<div class="path-wrap"><p class="meta"><b>Where it comes from</b> <span class="muted">· each step is a group nested inside the previous one</span></p>
      <ol class="path">${path.map((n, i) => `<li class="${key.has(n) ? "key" : ""}${i === path.length - 1 ? " last" : ""}"${COMMON[n] ? ` title="${COMMON[n]}"` : ""}>${n}</li>`).join("")}</ol></div>`;
  }

  function earliestHTML(f) {
    const gs = genera[f.family]?.genera;
    if (!gs?.length) return "";
    const hi = gs[0].range_ma[0];
    const first = gs.filter((g) => g.range_ma[0] === hi).slice(0, 3);
    const where = [...new Set(first.map((g) => Object.keys(g.continents).sort((a, b) => g.continents[b] - g.continents[a])[0]))];
    return `<p class="meta"><b>First to appear:</b> ${first.map((g) => `<i>${g.genus}</i>`).join(", ")} · ${where.join(", ")} · ~${fMa(hi)} Ma <span class="muted">(oldest records in the PBDB, not necessarily where the family originated)</span></p>`;
  }

  function render() {
    const f = families.find((d) => d.family === state.selected);
    f ? full(f) : empty();
  }

  el.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-family]");
    if (chip) select(chip.dataset.family);
    if (e.target.closest(".close")) select(state.selected);
  });

  return { render, updateAlive: () => {} };
})();

function bootError(e) {
  document.querySelector(".layout").innerHTML =
    `<section class="card"><h2>Error</h2><p>${e.message}</p><p class="note">Serve the project folder with <code>python3 -m http.server</code> and open <code>/prototype/</code>.</p></section>`;
  console.error(e);
}
