/* Horizontal timeline: 252 Ma (left) to 66 Ma (right), draggable cursor,
   zoom/pan, geological stages, and families that unfold into their genera. */

const horizontal = (() => {
  const el = document.getElementById("timeline");
  const M = { l: 168, r: 18, t: 26 };
  const BAND = 22, STAGE = 18, AREA = 84, GAP = 16, AXIS = 26, HEAD = 26, GROW = 22;
  const FULL = [252, 66];
  const MIN_SPAN = 3; // maximum zoom: 3 million years on screen
  let ROW = 32;
  let svg, x, g = {}, L = {};
  let view = FULL.slice();          // visible [oldest, most recent]
  const expanded = new Set();       // unfolded families
  let anim = null;

  /* ---------- zoom ---------- */
  const span = () => view[0] - view[1];
  function clampView(a, b) {
    let s = Math.min(FULL[0] - FULL[1], Math.max(MIN_SPAN, a - b));
    let c = (a + b) / 2;
    c = Math.min(FULL[0] - s / 2, Math.max(FULL[1] + s / 2, c));
    return [c + s / 2, c - s / 2];
  }
  function setView(v, animate = true) {
    const to = clampView(v[0], v[1]);
    if (anim) anim.stop();
    if (!animate) { view = to; render(); return; }
    const from = view.slice();
    const ip = d3.interpolate(from, to);
    anim = d3.timer((ms) => {
      const k = Math.min(1, ms / 260);
      view = ip(d3.easeCubicOut(k));
      render();
      if (k === 1) { anim.stop(); anim = null; }
    });
  }
  function zoomBy(factor, center = state.t) {
    const c = Math.min(view[0], Math.max(view[1], center));
    const s = span() * factor;
    const r = (view[0] - c) / span(); // keeps the point under the cursor/pointer in place
    setView([c + r * s, c - (1 - r) * s]);
  }
  const zoomTo = (a, b, pad = 0.08) => { const p = (a - b) * pad; setView([a + p, b - p]); };

  function bindControls() {
    const box = document.getElementById("zoom");
    if (!box) return;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.z === "in") zoomBy(0.5);
      if (b.dataset.z === "out") zoomBy(2);
      if (b.dataset.z === "all") setView(FULL);
      if (b.dataset.z === "fam") {
        const f = families.find((d) => d.family === state.selected);
        if (f) zoomTo(...famSpan(f));
      }
    });
  }
  // range to show when fitting a family: includes its genera
  function famSpan(f) {
    const gs = genera[f.family]?.genera || [];
    return [Math.max(f.range_ma[0], ...gs.map((g) => g.range_ma[0])), Math.min(f.range_ma[1], ...gs.map((g) => g.range_ma[1]))];
  }
  function updateControls() {
    const box = document.getElementById("zoom");
    if (!box) return;
    const fam = box.querySelector('[data-z="fam"]');
    fam.hidden = !state.selected;
    if (state.selected) fam.textContent = `Fit ${state.selected}`;
    box.querySelector('[data-z="all"]').disabled = span() >= FULL[0] - FULL[1] - 0.01;
    box.querySelector('[data-z="in"]').disabled = span() <= MIN_SPAN + 0.01;
    const lvl = document.getElementById("zoom-level");
    if (lvl) lvl.textContent = span() >= 185.9 ? "" : `${fMa(Math.round(view[0] * 10) / 10)}–${fMa(Math.round(view[1] * 10) / 10)} Ma`;
  }

  /* ---------- init ---------- */
  function init() {
    el.tabIndex = 0;
    el.setAttribute("role", "slider");
    el.setAttribute("aria-label", "Time in millions of years");
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") { setTime(state.t + step); e.preventDefault(); }
      if (e.key === "ArrowRight") { setTime(state.t - step); e.preventDefault(); }
      if (e.key === "+" || e.key === "=") { zoomBy(0.5); e.preventDefault(); }
      if (e.key === "-" || e.key === "_") { zoomBy(2); e.preventDefault(); }
      if (e.key === "0") { setView(FULL); e.preventDefault(); }
      if (e.key === "Escape" && state.selected) select(state.selected);
    });
    // Ctrl/⌘ + wheel (or trackpad pinch) = zoom; horizontal wheel or Shift + wheel = pan
    el.addEventListener("wheel", (e) => {
      if (!x) return;
      const [px] = d3.pointer(e, svg.node());
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomByInstant(Math.exp(e.deltaY * 0.004), x.invert(Math.max(M.l, px)));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        if (span() >= FULL[0] - FULL[1] - 0.01) return;
        e.preventDefault();
        const d = (e.shiftKey ? e.deltaY : e.deltaX) / (x.range()[1] - x.range()[0]) * span();
        view = clampView(view[0] - d, view[1] - d); render();
      }
    }, { passive: false });
    bindControls();
    render();
  }
  function zoomByInstant(factor, c) {
    const s = span() * factor, r = (view[0] - c) / span();
    view = clampView(c + r * s, c - (1 - r) * s); render();
  }

  /* ---------- render ---------- */
  function render() {
    const W = el.clientWidth || 800;
    const compact = W < 600;
    ROW = compact ? 26 : 32;
    const SIL = compact ? { w: 34, h: 20 } : { w: 48, h: 26 };
    const nameX = SIL.w + 8;
    M.l = nameX + (compact ? 128 : 150) + 12;
    const bandsTop = M.t, stageTop = M.t + BAND, areaTop = stageTop + STAGE;
    const rowsTop = areaTop + AREA + GAP;

    // rows: lineage header → families (by first appearance) → genera when unfolded
    const items = [];
    let yy = rowsTop;
    [...GROUPS, null].forEach((gr) => {
      const fs = families.filter((f) => (groupOf(f) || null) === gr)
        .sort((a, b) => b.range_ma[0] - a.range_ma[0] || b.range_ma[1] - a.range_ma[1]);
      if (!fs.length) return;
      items.push({ type: "head", gr, y: yy }); yy += HEAD;
      fs.forEach((f) => {
        items.push({ type: "fam", f, y: yy }); yy += ROW;
        if (expanded.has(f.family)) {
          (genera[f.family]?.genera || []).forEach((gn) => { items.push({ type: "genus", f, gn, y: yy }); yy += GROW; });
          yy += 6;
        }
      });
    });
    const H = yy + AXIS;
    L = { W, H, compact, nameX, SIL, rowsTop, areaTop };
    x = d3.scaleLinear().domain(view).range([M.l, W - M.r]);
    const y = d3.scaleLinear().domain([0, d3.max(diversity, (d) => d.genera)]).nice().range([areaTop + AREA, areaTop + 8]);
    const vis = (a, b) => a > view[1] && b < view[0]; // is the interval [a (older), b (younger)] in view?
    const X = (v) => Math.max(M.l - 2, Math.min(W - M.r + 2, x(v)));

    el.innerHTML = "";
    svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H);
    svg.append("defs").append("clipPath").attr("id", "plot-clip")
      .append("rect").attr("x", M.l).attr("y", 0).attr("width", W - M.r - M.l).attr("height", H);
    const plot = svg.append("g").attr("clip-path", "url(#plot-clip)");

    // period bands (full height) + stage row
    const bands = plot.append("g");
    periods.forEach((p, i) => {
      if (!vis(p.start, p.end)) return;
      const x0 = X(p.start), x1 = X(p.end), w = x1 - x0;
      bands.append("rect").attr("class", `period-band ${i % 2 ? "alt" : ""}`)
        .attr("x", x0).attr("width", w).attr("y", bandsTop).attr("height", H - bandsTop - AXIS);
      const short = p.name[0] + ". " + p.name.split(" ")[1];
      const label = w > 120 ? longPeriod(p.name) : w > 84 ? p.name : w > 40 ? short : w > 22 ? short.replace(". ", ".").slice(0, 3) : "";
      bands.append("text").attr("class", "period-label zoomable").attr("x", (x0 + x1) / 2).attr("y", bandsTop + 15)
        .attr("text-anchor", "middle").attr("data-zoom", `${p.start},${p.end}`).text(label)
        .append("title").text(`${longPeriod(p.name)} · ${fMa(p.start)}–${fMa(p.end)} Ma · click to zoom in`);
    });
    const st = plot.append("g").attr("class", "stages");
    stages.forEach((s) => {
      if (!vis(s.start, s.end)) return;
      const x0 = X(s.start), x1 = X(s.end), w = x1 - x0;
      st.append("rect").attr("class", "stage zoomable").attr("x", x0 + 0.5).attr("width", Math.max(0, w - 1))
        .attr("y", stageTop + 1).attr("height", STAGE - 3).attr("rx", 3).attr("data-zoom", `${s.start},${s.end}`)
        .append("title").text(`${s.name} · ${fMa(s.start)}–${fMa(s.end)} Ma · click to zoom in`);
      const label = w > s.name.length * 6.2 + 8 ? s.name : w > 30 ? s.name.slice(0, Math.floor((w - 8) / 6.2)) + "." : "";
      if (label) st.append("text").attr("class", "stage-label").attr("x", (x0 + x1) / 2).attr("y", stageTop + 11.5)
        .attr("text-anchor", "middle").text(label);
    });

    // diversity
    svg.append("g").attr("class", "grid")
      .selectAll("line").data(y.ticks(3).slice(1)).join("line")
      .attr("x1", M.l).attr("x2", W - M.r).attr("y1", y).attr("y2", y);
    svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`)
      .call(d3.axisLeft(y).ticks(3).tickSize(0).tickPadding(6).tickFormat(fNum)).call((a) => a.select(".domain").remove());
    svg.append("text").attr("class", "period-label").attr("x", M.l - (compact ? 34 : 40)).attr("y", areaTop + AREA / 2)
      .attr("text-anchor", "end").attr("dominant-baseline", "middle").text("Genera");
    svg.append("text").attr("class", "period-label").attr("x", M.l - 8).attr("y", stageTop + 11.5)
      .attr("text-anchor", "end").text(compact ? "" : "Stages");
    const curve = span() < 40 ? d3.curveStepAfter : d3.curveMonotoneX;
    const area = d3.area().x((d) => x(d.ma)).y0(y(0)).y1((d) => y(d.genera)).curve(curve);
    plot.append("path").datum(diversity).attr("class", "area").attr("d", area);
    plot.append("path").datum(diversity).attr("class", "area-line").attr("d", d3.line().x((d) => x(d.ma)).y((d) => y(d.genera)).curve(curve));

    // lineage headers
    const heads = items.filter((d) => d.type === "head");
    const gh = svg.append("g").selectAll("g").data(heads).join("g").attr("class", "group-head")
      .attr("transform", (d) => `translate(0,${d.y})`);
    const ght = gh.append("text").attr("x", 0).attr("y", HEAD - 8);
    ght.append("tspan").text((d) => (d.gr ? d.gr.label : "Other"));
    ght.append("tspan").attr("class", "group-hint").attr("dx", 8)
      .text((d) => (d.gr && !compact ? `${d.gr.clade.toLowerCase()} · ${d.gr.hint}` : ""));
    gh.append("line").attr("x1", 0).attr("x2", W - M.r).attr("y1", HEAD - 2).attr("y2", HEAD - 2);

    // families
    const famItems = items.filter((d) => d.type === "fam");
    g.rows = svg.append("g").selectAll("g").data(famItems, (d) => d.f.family).join("g")
      .attr("class", "fam-row").attr("transform", (d) => `translate(0,${d.y})`);
    g.rows.append("rect").attr("class", "row-hit").attr("x", 0).attr("width", W - M.r).attr("height", ROW).attr("rx", 4);
    g.rows.filter((d) => d.f.phylopic?.svg).append("image").attr("class", "sil row-sil")
      .attr("href", (d) => DATA + d.f.phylopic.svg).attr("x", 0).attr("y", (ROW - SIL.h) / 2)
      .attr("width", SIL.w).attr("height", SIL.h).attr("preserveAspectRatio", "xMidYMid meet");
    g.rows.append("text").attr("class", "chev").attr("x", nameX).attr("y", ROW / 2).attr("dominant-baseline", "central")
      .text((d) => (genera[d.f.family]?.genera?.length ? (expanded.has(d.f.family) ? "▾" : "▸") : ""));
    g.rows.append("text").attr("class", "row-label").attr("x", nameX + 12).attr("y", ROW / 2)
      .attr("dominant-baseline", "central").style("font-size", compact ? "11px" : null).text((d) => d.f.family);
    const fbars = g.rows.filter((d) => vis(d.f.range_ma[0], d.f.range_ma[1]));
    fbars.append("rect").attr("class", "bar").attr("clip-path", "url(#plot-clip)")
      .attr("x", (d) => x(d.f.range_ma[0])).attr("width", (d) => Math.max(4, x(d.f.range_ma[1]) - x(d.f.range_ma[0])))
      .attr("y", (ROW - 12) / 2).attr("height", 12).attr("rx", 4).attr("fill", (d) => dietOf(d.f).color);
    g.rows
      .on("pointermove", (ev, d) => showTip(
        (d.f.phylopic?.svg ? `<img class="tip-sil" src="${DATA + d.f.phylopic.svg}" alt="">` : "") +
        `<b>${d.f.family}</b><br><span>${fMa(d.f.range_ma[0])}–${fMa(d.f.range_ma[1])} Ma · ${fNum(d.f.n_genera)} genera · ${dietOf(d.f).label.toLowerCase()}</span>` +
        `<br><span>${expanded.has(d.f.family) ? "Click to fold" : "Click to unfold its genera"}</span>`, ev))
      .on("pointerleave", hideTip);

    // genera (unfolded rows)
    const gItems = items.filter((d) => d.type === "genus");
    g.genus = svg.append("g").selectAll("g").data(gItems, (d) => d.f.family + "/" + d.gn.genus).join("g")
      .attr("class", "genus-row").attr("transform", (d) => `translate(0,${d.y})`);
    g.genus.append("rect").attr("class", "row-hit genus-hit").attr("x", nameX).attr("width", W - M.r - nameX).attr("height", GROW).attr("rx", 4);
    g.genus.append("line").attr("class", "genus-guide").attr("x1", nameX + 4).attr("x2", nameX + 4).attr("y1", 0).attr("y2", GROW);
    g.genus.append("text").attr("class", "genus-label").attr("x", nameX + 16).attr("y", GROW / 2).attr("dominant-baseline", "central")
      .text((d) => d.gn.genus);
    g.genus.append("text").attr("class", "genus-n").attr("x", M.l - 8).attr("y", GROW / 2).attr("dominant-baseline", "central")
      .attr("text-anchor", "end").text((d) => (compact ? "" : fNum(d.gn.n)));
    g.genus.filter((d) => vis(d.gn.range_ma[0], d.gn.range_ma[1])).append("rect").attr("class", "gbar").attr("clip-path", "url(#plot-clip)")
      .attr("x", (d) => x(d.gn.range_ma[0])).attr("width", (d) => Math.max(3, x(d.gn.range_ma[1]) - x(d.gn.range_ma[0])))
      .attr("y", (GROW - 7) / 2).attr("height", 7).attr("rx", 3.5).attr("fill", (d) => dietOf(d.f).color);
    g.genus
      .on("pointermove", (ev, d) => {
        const sp = d.gn.species.map((s) => `<i>${s.name}</i>`).join(", ") || "species undetermined";
        const cont = Object.entries(d.gn.continents).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${fNum(n)}`).join(" · ");
        showTip(`<b><i>${d.gn.genus}</i></b> <span>· ${d.f.family}</span><br><span>${fMa(d.gn.range_ma[0])}–${fMa(d.gn.range_ma[1])} Ma · ${fNum(d.gn.n)} fossils</span><br><span>${cont}</span><br><span>${sp}</span>`, ev);
      })
      .on("pointerleave", hideTip);

    // extinctions
    const ex = plot.append("g").attr("class", "extinction").style("pointer-events", "none");
    EXTINCTIONS.forEach((e) => {
      if (e.ma > view[0] || e.ma < view[1]) return;
      ex.append("line").attr("x1", x(e.ma)).attr("x2", x(e.ma)).attr("y1", areaTop).attr("y2", H - AXIS);
      ex.append("text").attr("x", x(e.ma) - 5).attr("y", areaTop + AREA - 6).attr("text-anchor", "end").text(compact ? e.short : e.label);
    });

    // bottom axis: ticks adapt to the zoom
    const nT = compact ? 3 : 8;
    const fmtT = span() < 12 ? (v) => `${fmt.format(",.1f")(v)} Ma` : (v) => `${fMa(v)} Ma`;
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - AXIS + 4})`)
      .call(d3.axisBottom(x).ticks(nT).tickSize(4).tickFormat(fmtT));

    // cursor
    g.cursor = svg.append("g").style("pointer-events", "none");
    g.cursor.append("line").attr("class", "cursor-line").attr("y1", M.t - 4).attr("y2", H - AXIS);
    g.cursor.append("rect").attr("class", "cursor-handle").attr("y", M.t - 24).attr("height", 20).attr("rx", 5);
    g.cursor.append("text").attr("class", "cursor-label").attr("y", M.t - 10).attr("text-anchor", "middle");
    g.cursor.append("text").attr("class", "cursor-count").attr("text-anchor", "start");
    g.y = y;

    // interaction: click a family = select + unfold; a genus = show it on the map;
    // a period/stage = zoom in; drag on the background = move the cursor
    let dragging = false;
    const toT = (ev) => x.invert(Math.max(M.l, Math.min(W - M.r, d3.pointer(ev, svg.node())[0])));
    svg.on("pointerdown", (ev) => {
      const z = ev.target.closest("[data-zoom]");
      if (z) { const [a, b] = z.dataset.zoom.split(",").map(Number); zoomTo(a, b, 0.04); return; }
      const gr = ev.target.closest(".genus-row");
      if (gr) { const d = d3.select(gr).datum(); hideTip(); pickGenus(d.f.family, d.gn.genus); return; }
      const fr = ev.target.closest(".fam-row");
      if (fr) { const d = d3.select(fr).datum(); hideTip(); toggleFamily(d.f.family); return; }
      const [px] = d3.pointer(ev, svg.node());
      if (px < M.l - 4) return;
      dragging = true; svg.node().setPointerCapture(ev.pointerId); hideTip(); setTime(toT(ev));
    }).on("pointermove", (ev) => { if (dragging) setTime(toT(ev)); })
      .on("pointerup pointercancel", () => (dragging = false));

    updateControls();
    update();
  }

  function toggleFamily(name) {
    const opening = state.selected !== name;
    if (opening) expanded.add(name); else expanded.delete(name);
    select(name); // selects or deselects (and redraws the panel and the map)
    render();
  }
  function pickGenus(fam, genus) {
    if (state.selected !== fam) { state.selected = fam; state.genus = null; detail.render(); }
    selectGenus(genus);
  }

  function update() {
    if (!g.rows) return;
    const inView = state.t <= view[0] && state.t >= view[1];
    g.cursor.style("display", inView ? null : "none");
    const cx = x(state.t);
    g.cursor.select("line").attr("x1", cx).attr("x2", cx);
    const lbl = `${fMa(state.t)} Ma`;
    const w = lbl.length * 6.6 + 12;
    const hx = Math.max(M.l - 10 + w / 2, Math.min(x.range()[1] + 10 - w / 2, cx));
    g.cursor.select(".cursor-handle").attr("x", hx - w / 2).attr("width", w);
    g.cursor.select(".cursor-label").attr("x", hx).text(lbl);
    const d = diversity.find((d) => d.ma === Math.round(state.t)) || { genera: 0 };
    const right = cx > x.range()[1] - 80;
    g.cursor.select(".cursor-count").attr("x", cx + (right ? -6 : 6)).attr("y", g.y(d.genera) - 6)
      .attr("text-anchor", right ? "end" : "start").text(`${fNum(d.genera)} genera`);
    const sel = state.selected;
    g.rows.select(".bar").classed("dim", (r) => !alive(r.f) && r.f.family !== sel);
    g.rows.select(".row-sil").classed("dim", (r) => !alive(r.f) && r.f.family !== sel);
    g.rows.select(".row-label").classed("dim", (r) => !alive(r.f)).classed("selected", (r) => r.f.family === sel);
    g.rows.select(".row-hit").classed("selected", (r) => r.f.family === sel && !state.genus);
    const gAlive = (gn) => state.t <= gn.range_ma[0] && state.t >= gn.range_ma[1];
    g.genus.select(".gbar").classed("dim", (r) => !gAlive(r.gn));
    g.genus.select(".genus-label").classed("alive", (r) => gAlive(r.gn)).classed("selected", (r) => r.gn.genus === state.genus);
    g.genus.select(".genus-hit").classed("selected", (r) => r.gn.genus === state.genus);
    updateControls();
    el.setAttribute("aria-valuenow", state.t);
    el.setAttribute("aria-valuetext", `${fMa(state.t)} million years ago`);
  }

  // if the time leaves the view (keyboard, jump to a family), pan the view to follow it
  function goTo(t) {
    if (t > view[0] || t < view[1]) { const s = span(); setView([t + s / 2, t - s / 2]); }
    setTime(t);
  }

  return { init, render, update, goTo, showsGenera: true };
})();

boot(horizontal).catch(bootError);
