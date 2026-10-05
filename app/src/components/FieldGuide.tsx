/* The field guide: "what lived here?". Pick a continent, or click anywhere on today's map to take a zone around that
   point, and see which dinosaurs have been found there and when: one row per genus, a bar from its oldest to its
   youngest fossil in that place. Hovering a row lights its sites on the map; clicking it opens its profile. */
import { geoCircle, geoEqualEarth, geoGraticule10, geoPath, scaleLinear, type GeoPermissibleObjects } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import landUrl from "../assets/land-110m.json?url";
import { GROUPS, TIME, dietOf, groupOf } from "../constants";
import { silhouetteUrl } from "../data";
import { fMa, fNum } from "../format";
import { useWidth } from "../hooks";
import { useStore } from "../state";
import type { Family, Fossil, Genus } from "../types";
import s from "./FieldGuide.module.css";

const CONTINENTS = ["North America", "South America", "Europe", "Africa", "Asia", "Oceania"] as const;
const ZONES = [{ km: 500, label: "S" }, { km: 1000, label: "M" }, { km: 2000, label: "L" }] as const;
type Region = { kind: "world" } | { kind: "continent"; name: string } | { kind: "zone"; lon: number; lat: number; km: number };
type Sort = "first" | "fossils" | "name";

/** Same rule as scripts/build_families.py, so the continents match the rest of the app. */
const continentOf = ([lo, la]: [number, number]) =>
  lo < -30 ? (la < 12 ? "South America" : "North America")
    : la < -10 && lo > 110 ? "Oceania"
      : lo < 60 ? (la < 37 ? "Africa" : "Europe") : "Asia";

/** Great-circle distance in km. */
const km = ([lo1, la1]: [number, number], [lo2, la2]: [number, number]) => {
  const r = Math.PI / 180, a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
};

interface Row { g: Genus | null; genus: string; f: Family; first: number; last: number; n: number }

export function FieldGuide() {
  const { data, state, dispatch } = useStore();
  // where the selection (a family, or a genus) has been found, continent by continent
  const isSel = (fo: Fossil) => !!state.selected && fo.family === state.selected && (!state.genus || fo.genus === state.genus);
  const selWhere = useMemo(() => {
    const n = new Map<string, number>();
    for (const fo of data.fossils) if (fo.here && isSel(fo)) n.set(continentOf(fo.here), (n.get(continentOf(fo.here)) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]);
  }, [data, state.selected, state.genus]); // eslint-disable-line react-hooks/exhaustive-deps
  // arriving with a selection: start where it has the most fossils
  const [region, setRegion] = useState<Region>(() => ({ kind: "continent", name: selWhere[0]?.[0] ?? "North America" }));
  const [zoneKm, setZoneKm] = useState(1000);
  const [lineage, setLineage] = useState<string | null>(null);
  const [diet, setDiet] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("first");
  const [hover, setHover] = useState<string | null>(null);

  // today's land, loaded once
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  useEffect(() => { fetch(landUrl).then((r) => r.json()).then(setLand, () => setLand(null)); }, []);

  const famBy = useMemo(() => new Map(data.families.map((f) => [f.family, f])), [data]);
  const genusBy = useMemo(() => {
    const m = new Map<string, Genus>();
    for (const fg of Object.values(data.genera)) for (const g of fg.genera) m.set(g.genus, g);
    return m;
  }, [data]);

  /* ---------- the fossils in the region ---------- */
  const inRegion = (fo: Fossil) => {
    if (!fo.here) return false;
    if (region.kind === "world") return true;
    if (region.kind === "continent") return continentOf(fo.here) === region.name;
    return km(fo.here, [region.lon, region.lat]) <= region.km;
  };
  const found = useMemo(() => data.fossils.filter((fo) => fo.family && famBy.has(fo.family) && inRegion(fo)),
    [data, famBy, region]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- one row per genus: its oldest and youngest fossil here ---------- */
  const rows = useMemo(() => {
    const by = new Map<string, Row>();
    for (const fo of found) {
      const r = by.get(fo.genus);
      if (r) { r.first = Math.max(r.first, fo.mid); r.last = Math.min(r.last, fo.mid); r.n++; }
      else by.set(fo.genus, { g: genusBy.get(fo.genus) ?? null, genus: fo.genus, f: famBy.get(fo.family!)!, first: fo.mid, last: fo.mid, n: 1 });
    }
    const needle = q.trim().toLowerCase();
    const out = [...by.values()].filter((r) =>
      (!lineage || groupOf(r.f)?.key === lineage)
      && (!diet || (r.f.pbdb?.diet ?? "none") === diet)
      && (!needle || r.genus.toLowerCase().includes(needle) || r.f.family.toLowerCase().includes(needle)));
    return out.sort((a, b) => sort === "name" ? a.genus.localeCompare(b.genus) : sort === "fossils" ? b.n - a.n : b.first - a.first || b.n - a.n);
  }, [found, genusBy, famBy, lineage, diet, q, sort]);

  /* ---------- the map: today's world ---------- */
  const mapWrap = useRef<HTMLDivElement>(null);
  const mapW = useWidth(mapWrap, 600);
  const mapH = Math.round(mapW * 0.52);
  const proj = useMemo(() => geoEqualEarth().fitExtent([[4, 4], [mapW - 4, mapH - 4]], { type: "Sphere" }), [mapW, mapH]);
  const path = useMemo(() => geoPath(proj), [proj]);
  // one dot per site (many fossils share one)
  const sites = useMemo(() => {
    const m = new Map<number, { xy: [number, number]; inside: boolean; genera: Set<string>; families: Set<string> }>();
    for (const fo of data.fossils) {
      if (!fo.here || !fo.family || !famBy.has(fo.family)) continue;
      let site = m.get(fo.loc);
      if (!site) {
        const p = proj(fo.here);
        if (!p) continue;
        m.set(fo.loc, (site = { xy: p as [number, number], inside: inRegion(fo), genera: new Set(), families: new Set() }));
      }
      site.genera.add(fo.genus);
      site.families.add(fo.family);
    }
    return [...m.values()];
  }, [data, famBy, proj, region]); // eslint-disable-line react-hooks/exhaustive-deps
  const lit = hover ?? state.genus;
  const litFamily = !hover && !state.genus ? state.selected : null; // a family selection lights all its sites
  const isLit = (site: { genera: Set<string>; families: Set<string> }) => (lit ? site.genera.has(lit) : !!litFamily && site.families.has(litFamily));
  const zonePath = region.kind === "zone" ? path(geoCircle().center([region.lon, region.lat]).radius(region.km / 111.2)()) ?? "" : "";

  const clickMap = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ll = proj.invert?.([((e.clientX - r.left) / r.width) * mapW, ((e.clientY - r.top) / r.height) * mapH]);
    if (ll && Number.isFinite(ll[0])) setRegion({ kind: "zone", lon: ll[0], lat: ll[1], km: zoneKm });
  };
  const setZone = (k: number) => { setZoneKm(k); if (region.kind === "zone") setRegion({ ...region, km: k }); };

  /** A suggestion was picked: select it and go where most of its fossils are. */
  const pick = (sg: Suggestion) => {
    setQ(""); setLineage(null); setDiet(null);
    dispatch(sg.genus ? { type: "genus", family: sg.family, genus: sg.genus } : { type: "select", family: sg.family });
    const n = new Map<string, number>();
    for (const fo of data.fossils) if (fo.here && fo.family === sg.family && (!sg.genus || fo.genus === sg.genus)) n.set(continentOf(fo.here), (n.get(continentOf(fo.here)) ?? 0) + 1);
    const best = [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
    const here = region.kind === "world" || (region.kind === "continent" && n.has(region.name));
    if (best && !here) setRegion({ kind: "continent", name: best });
  };

  /* ---------- the selection in the list: highlighted, and scrolled into view ---------- */
  const isSelRow = (r: Row) => !!state.selected && r.f.family === state.selected && (!state.genus || r.genus === state.genus);
  const firstSel = rows.find(isSelRow);
  const selRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [state.selected, state.genus, region]);

  /* ---------- the list's time axis ---------- */
  const listWrap = useRef<HTMLDivElement>(null);
  const listW = useWidth(listWrap, 480);
  const LABEL = Math.min(210, Math.max(150, listW * 0.38));
  const x = scaleLinear().domain(TIME).range([LABEL + 6, listW - 34]);

  const title = region.kind === "world" ? "The whole world" : region.kind === "continent" ? region.name
    : `${fNum(region.km)} km around ${Math.abs(region.lat).toFixed(0)}°${region.lat >= 0 ? "N" : "S"}, ${Math.abs(region.lon).toFixed(0)}°${region.lon >= 0 ? "E" : "W"}`;
  const nFamilies = new Set(rows.map((r) => r.f.family)).size;

  const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) =>
    <button className={`${s.chip} ${on ? s.chipOn : ""}`} aria-pressed={on} onClick={onClick}>{children}</button>;

  return (
    <section className={`card ${s.card}`} aria-label="Field guide: what lived here?">
      {/* left: where */}
      <div className={s.where}>
        <h2 className={s.question}>What lived here?</h2>
        <div className={s.row}>
          <Chip on={region.kind === "world"} onClick={() => setRegion({ kind: "world" })}>World</Chip>
          {CONTINENTS.map((c) => (
            <Chip key={c} on={region.kind === "continent" && region.name === c} onClick={() => setRegion({ kind: "continent", name: c })}>{c}</Chip>
          ))}
        </div>
        <div ref={mapWrap} className={s.mapBox}>
          <svg viewBox={`0 0 ${mapW} ${mapH}`} width={mapW} height={mapH} className={s.map} onClick={clickMap} role="img"
            aria-label="Today's world with every dinosaur fossil site; click to pick a zone">
            <path className={s.sphere} d={path({ type: "Sphere" }) ?? ""} />
            <path className={s.graticule} d={path(geoGraticule10()) ?? ""} />
            {land && <path className={s.land} d={path(land) ?? ""} />}
            {zonePath && <path className={s.zone} d={zonePath} />}
            {sites.map((site, i) => (
              <circle key={i} cx={site.xy[0]} cy={site.xy[1]} r={site.inside ? 2.2 : 1.6}
                className={isLit(site) ? s.siteLit : site.inside ? s.siteIn : s.siteOut} />
            ))}
            {sites.filter(isLit).map((site, i) => (
              <circle key={`l${i}`} cx={site.xy[0]} cy={site.xy[1]} r={4.5} className={s.siteLit} />
            ))}
          </svg>
        </div>
        <div className={s.zoneBar}>
          <span>Click the map to pick a zone around a point · size</span>
          <span className={s.seg} role="group" aria-label="Zone size">
            {ZONES.map((z) => <button key={z.km} aria-pressed={zoneKm === z.km} onClick={() => setZone(z.km)} title={`${fNum(z.km)} km`}>{z.label}</button>)}
          </span>
        </div>
        <Through found={found} famBy={famBy} width={mapW} t={state.t} />
        <p className={s.credit}>Each dot is a fossil site, where it is today. Map: Natural Earth.</p>
      </div>

      {/* right: who, and when */}
      <div className={s.who}>
        <header className={s.whoHead}>
          <h3>{title}</h3>
          <p><b>{fNum(rows.length)}</b> genera · <b>{fNum(nFamilies)}</b> families · <b>{fNum(rows.reduce((n, r) => n + r.n, 0))}</b> fossils</p>
        </header>
        <div className={s.filters}>
          <Search value={q} onChange={setQ} onPick={pick} />
          <div className={s.row}>
            {GROUPS.map((g) => <Chip key={g.key} on={lineage === g.key} onClick={() => setLineage(lineage === g.key ? null : g.key)}>{g.label}</Chip>)}
            <span className={s.divider} />
            <Chip on={diet === "herbivore"} onClick={() => setDiet(diet === "herbivore" ? null : "herbivore")}><i className="swatch" style={{ background: "var(--herb)" }} />Plant-eaters</Chip>
            <Chip on={diet === "carnivore"} onClick={() => setDiet(diet === "carnivore" ? null : "carnivore")}><i className="swatch" style={{ background: "var(--carn)" }} />Meat-eaters</Chip>
            <span className={s.spacer} />
            <label className={s.sort}>Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="first">Oldest first</option>
                <option value="fossils">Most fossils</option>
                <option value="name">A–Z</option>
              </select>
            </label>
          </div>
        </div>

        <div ref={listWrap} className={s.axis}>
          <svg width={listW} height={26}>
            {data.periods.map((p, i) => (
              <g key={p.name}>
                <rect x={x(p.start)} width={x(p.end) - x(p.start)} y={0} height={18} className={i % 2 ? s.bandAlt : s.band} />
              </g>
            ))}
            {/* the three periods by name; the bands are their epochs */}
            {["Triassic", "Jurassic", "Cretaceous"].map((name) => {
              const ps = data.periods.filter((p) => p.name.endsWith(name));
              if (!ps.length) return null;
              const x0 = x(Math.max(...ps.map((p) => p.start))), x1 = x(Math.min(...ps.map((p) => p.end)));
              return <text key={name} x={(x0 + x1) / 2} y={13} className={s.bandLabel}>{name}</text>;
            })}
            <line x1={x(state.t)} x2={x(state.t)} y1={0} y2={26} className={s.cursor} />
          </svg>
        </div>

        <div className={s.list}>
          {/* the selection: where it is in this list, or where else to look for it */}
          {state.selected && !rows.some(isSelRow) && (
            <div className={s.notice}>
              <b>{state.genus ? <i>{state.genus}</i> : state.selected}</b>{" "}
              {selWhere.length === 0 ? "has no fossil sites on the map." : <>has no fossils {region.kind === "zone" ? "in this zone" : `in ${title}`}{q || lineage || diet ? " that match the filters" : ""}. Found in{" "}
                {selWhere.slice(0, 3).map(([c, n], i) => (
                  <span key={c}>{i > 0 && ", "}<button onClick={() => { setRegion({ kind: "continent", name: c }); setQ(""); setLineage(null); setDiet(null); }}>{c} ({fNum(n)})</button></span>
                ))}.</>}
            </div>
          )}
          {rows.length === 0 && <p className={s.empty}>No dinosaur fossils match here. Try a bigger zone or another place.</p>}
          {rows.map((r) => {
            const own = r.g?.phylopic?.svg, sil = own ?? r.f.phylopic?.svg;
            const sel = isSelRow(r);
            return (
              <button key={r.genus} ref={sel && r === firstSel ? selRef : undefined} className={`${s.item} ${sel ? s.itemSel : ""}`} style={{ ["--lw" as string]: `${LABEL}px` }}
                onMouseEnter={() => setHover(r.genus)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(r.genus)} onBlur={() => setHover(null)}
                onClick={() => (r.g ? dispatch({ type: "genus", family: r.f.family, genus: r.genus }) : dispatch({ type: "select", family: r.f.family }))}
                title={`${r.genus} · ${r.f.family} · ${fNum(r.n)} ${r.n === 1 ? "fossil" : "fossils"} here, ${fMa(Math.round(r.first * 10) / 10)}–${fMa(Math.round(r.last * 10) / 10)} Ma`}>
                <span className={s.label}>
                  <i className={`${s.sil} ${own ? "" : s.silBorrowed}`} style={sil ? { ["--src" as string]: `url("${silhouetteUrl(sil)}")` } : undefined}
                    title={own ? undefined : "Family silhouette: there is no drawing of this genus"} />
                  <span className={s.names}><i>{r.genus}</i><small>{r.f.family}</small></span>
                </span>
                <svg className={s.bar} width={listW - LABEL} height={22} viewBox={`${LABEL} 0 ${listW - LABEL} 22`}>
                  <line x1={x(state.t)} x2={x(state.t)} y1={0} y2={22} className={s.cursorFaint} />
                  <rect x={x(r.first) - 1.5} width={Math.max(3, x(r.last) - x(r.first) + 3)} y={8} height={6} rx={3} fill={dietOf(r.f).color} />
                  <text x={Math.max(x(r.first), x(r.last)) + 8} y={14.5} className={s.n}>{fNum(r.n)}</text>
                </svg>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Fossils found in the region through time, every 2 million years, split by diet. */
function Through({ found, famBy, width, t }: { found: Fossil[]; famBy: Map<string, Family>; width: number; t: number }) {
  const { data } = useStore();
  const STEP = 2, H = 110, top = 18, bottom = 18;
  const bins = useMemo(() => {
    const n = Math.ceil((TIME[0] - TIME[1]) / STEP);
    const out = Array.from({ length: n }, (_, i) => ({ start: TIME[0] - i * STEP, herb: 0, carn: 0, other: 0 }));
    for (const fo of found) {
      const i = Math.floor((TIME[0] - fo.mid) / STEP);
      if (i < 0 || i >= n) continue;
      const d = famBy.get(fo.family!)?.pbdb?.diet;
      if (d === "herbivore") out[i].herb++; else if (d === "carnivore") out[i].carn++; else out[i].other++;
    }
    return out;
  }, [found, famBy]);
  const x = scaleLinear().domain(TIME).range([0, width]);
  const max = Math.max(1, ...bins.map((b) => b.herb + b.carn + b.other));
  const y = scaleLinear().domain([0, max]).range([H - bottom, top]);
  const w = Math.max(1, x(TIME[0] - STEP) - x(TIME[0]) - 1);
  return (
    <figure className={s.through}>
      <figcaption>Fossils found here, through time <span>· plant-eaters, meat-eaters, unknown</span></figcaption>
      <svg width={width} height={H} role="img" aria-label="Fossils found in this region through time">
        {data.periods.map((p, i) => (
          <rect key={p.name} x={x(p.start)} width={x(p.end) - x(p.start)} y={top} height={H - top - bottom} className={i % 2 ? s.bandAlt : s.band} />
        ))}
        {bins.map((b) => {
          let base = H - bottom;
          return (["herb", "carn", "other"] as const).map((k) => {
            const v = b[k];
            if (!v) return null;
            const h = H - bottom - y(v), yy = base - h; // stacked from the baseline up
            base = yy;
            return <rect key={`${b.start}${k}`} x={x(b.start)} width={w} y={yy} height={h} fill={k === "herb" ? "var(--herb)" : k === "carn" ? "var(--carn)" : "var(--unknown)"} />;
          });
        })}
        <line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - bottom} className={s.cursor} />
        {[200, 150, 100].map((v) => <text key={v} x={x(v)} y={H - 4} className={s.tick}>{v} Ma</text>)}
        <text x={0} y={11} className={s.scale}>{fNum(max)} {max === 1 ? "fossil" : "fossils"} per 2 Myr</text>
      </svg>
    </figure>
  );
}

/* ---------- the search box, with suggestions: genera, families and species, forgiving with hard names ---------- */
interface Suggestion { kind: "genus" | "family" | "species"; label: string; family: string; genus?: string; sil?: string | null; own: boolean; note: string }

/** How well a name matches what was typed: start of the name > start of a word > anywhere > letters in order. */
const score = (name: string, needle: string) => {
  const n = name.toLowerCase();
  if (n.startsWith(needle)) return 4;
  if (n.split(/[\s-]/).some((w) => w.startsWith(needle))) return 3;
  if (n.includes(needle)) return 2;
  let i = 0;
  for (const ch of n) if (ch === needle[i]) i++;
  return i === needle.length && needle.length >= 3 ? 1 : 0; // "tyrnsrs" still finds Tyrannosaurus
};

function Search({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (s: Suggestion) => void }) {
  const { data } = useStore();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const all = useMemo(() => {
    const out: Suggestion[] = [];
    for (const f of data.families) {
      out.push({ kind: "family", label: f.family, family: f.family, sil: f.phylopic?.svg, own: true, note: `family · ${fNum(f.n_genera)} genera` });
      for (const g of data.genera[f.family]?.genera ?? []) {
        const sil = g.phylopic?.svg ?? f.phylopic?.svg;
        out.push({ kind: "genus", label: g.genus, family: f.family, genus: g.genus, sil, own: !!g.phylopic?.svg, note: f.family });
        for (const sp of g.species) out.push({ kind: "species", label: sp.name, family: f.family, genus: g.genus, sil, own: !!g.phylopic?.svg, note: `species of ${g.genus}` });
      }
    }
    return out;
  }, [data]);
  const needle = value.trim().toLowerCase();
  const hits = useMemo(() => {
    if (needle.length < 2) return [];
    const rank = { genus: 0, family: 1, species: 2 } as const;
    return all.map((sg) => ({ sg, sc: score(sg.label, needle) })).filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc || rank[a.sg.kind] - rank[b.sg.kind] || a.sg.label.length - b.sg.label.length)
      .slice(0, 8).map((x) => x.sg);
  }, [all, needle]);
  const show = open && hits.length > 0;
  const choose = (sg: Suggestion) => { setOpen(false); onPick(sg); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!show) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((active + 1) % hits.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((active - 1 + hits.length) % hits.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(hits[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  };
  // a highlighted name: the typed letters in bold where they match as a block
  const mark = (label: string) => {
    const i = label.toLowerCase().indexOf(needle);
    return i < 0 ? label : <>{label.slice(0, i)}<b>{label.slice(i, i + needle.length)}</b>{label.slice(i + needle.length)}</>;
  };
  return (
    <div className={s.searchBox}>
      <input className={s.search} type="search" placeholder="Find a dinosaur, family or species…" value={value} autoComplete="off"
        role="combobox" aria-expanded={show} aria-controls="fg-suggest" aria-autocomplete="list"
        aria-activedescendant={show ? `fg-sg-${active}` : undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey} />
      {show && (
        <ul id="fg-suggest" role="listbox" className={s.suggest}>
          {hits.map((sg, i) => (
            <li key={`${sg.kind}-${sg.label}-${sg.genus ?? ""}`} id={`fg-sg-${i}`} role="option" aria-selected={i === active}
              className={i === active ? s.sgOn : undefined} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(sg); }}>
              <i className={`${s.sgSil} ${sg.own ? "" : s.silBorrowed}`} style={sg.sil ? { ["--src" as string]: `url("${silhouetteUrl(sg.sil)}")` } : undefined} />
              <span className={s.sgName}>{sg.kind === "family" ? mark(sg.label) : <i>{mark(sg.label)}</i>}</span>
              <span className={s.sgNote}>{sg.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
