/* The field guide: "what lived here?". Pick a continent, or click anywhere on today's map to take a zone around that
   point, and see which dinosaurs have been found there and when: one row per genus, a bar from its oldest to its
   youngest fossil in that place. Hovering a row lights its sites on the map; clicking it opens its profile. */
import { geoCircle, geoEqualEarth, geoGraticule10, geoPath, scaleLinear, type GeoPermissibleObjects } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import landUrl from "../assets/land-110m.json?url";
import { DIET, GROUPS, TIME, dietOf, groupOf, paint } from "../constants";
import { silhouetteUrl } from "../data";
import { fMa, fNum } from "../format";
import { revealInScroller, useWidth } from "../hooks";
import { useStore } from "../state";
import type { Family, Fossil, Genus } from "../types";
import s from "./FieldGuide.module.css";
import { KeysHint, useKeysHint } from "./KeysHint";

const CONTINENTS = ["North America", "South America", "Europe", "Africa", "Asia", "Oceania"] as const;
const ZONES = [{ km: 500, label: "S" }, { km: 1000, label: "M" }, { km: 2000, label: "L" }] as const;
/** `spot`: the hotspot it was picked from (centered on it), or `near`: the hotspot closest to a click, if any. */
type Region = { kind: "world" } | { kind: "continent"; name: string } | { kind: "zone"; lon: number; lat: number; km: number; spot?: string; near?: string };

/** Where dinosaur fossils cluster, named so a zone can be picked from a menu (and read) instead of only clicked.
    Centers come from the densest groups of sites in fossils.json. */
const HOTSPOTS: { group: string; name: string; at: [number, number] }[] = [
  { group: "North America", name: "Montana & Dakotas", at: [-107, 47] },
  { group: "North America", name: "Alberta", at: [-112, 51] },
  { group: "North America", name: "Colorado Plateau", at: [-108, 39] },
  { group: "North America", name: "Texas & New Mexico", at: [-102, 32] },
  { group: "North America", name: "US East Coast", at: [-76, 39.5] },
  { group: "South America", name: "Patagonia", at: [-69, -41] },
  { group: "South America", name: "NW Argentina", at: [-68, -30] },
  { group: "South America", name: "Southern Brazil", at: [-52, -22] },
  { group: "Europe", name: "England", at: [-1.5, 51.5] },
  { group: "Europe", name: "France", at: [1, 45.5] },
  { group: "Europe", name: "Iberia", at: [-3.5, 41] },
  { group: "Europe", name: "Germany & Austria", at: [13, 48.5] },
  { group: "Europe", name: "Romania (Hațeg)", at: [23, 45.5] },
  { group: "Africa", name: "Morocco", at: [-4, 31] },
  { group: "Africa", name: "Niger", at: [8, 17] },
  { group: "Africa", name: "Tanzania", at: [36, -10] },
  { group: "Africa", name: "South Africa & Lesotho", at: [27, -28.5] },
  { group: "Africa", name: "Madagascar", at: [46.5, -16.5] },
  { group: "Asia", name: "Gobi", at: [105, 42.5] },
  { group: "Asia", name: "Liaoning & Inner Mongolia", at: [120, 41] },
  { group: "Asia", name: "Sichuan & Yunnan", at: [104, 27] },
  { group: "Asia", name: "Central Asia", at: [67, 42] },
  { group: "Asia", name: "India", at: [77, 22] },
  { group: "Asia", name: "Japan", at: [136, 36] },
  { group: "Oceania", name: "Queensland", at: [143, -22] },
  { group: "Antarctica", name: "Antarctic Peninsula", at: [-60, -65] },
];
const HOTSPOT_GROUPS = [...new Set(HOTSPOTS.map((h) => h.group))];
const NEAR_KM = 300; // a click this close to a hotspot's center is named after it
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

/** One genus found in the region. `f` is set when its family is one of the app's; otherwise `pfam` is its PBDB family
    (or null) and the row has no profile: it is listed so that "what lived here" is the whole answer. */
interface Row { g: Genus | null; genus: string; f: Family | null; pfam: string | null; first: number; last: number; n: number }
/** A genus outside the app's families, picked in this view (it has no profile, so it stays local to the field guide). */
interface Pinned { genus: string; family: string | null }

export function FieldGuide() {
  const { data, state, dispatch } = useStore();
  // where the selection (a family, or a genus) has been found, continent by continent
  const isSel = (fo: Fossil) => !!state.selected && fo.family === state.selected && (!state.genus || fo.genus === state.genus);
  const selWhere = useMemo(() => {
    const n = new Map<string, number>();
    for (const fo of data.fossils) if (fo.here && isSel(fo)) n.set(continentOf(fo.here), (n.get(continentOf(fo.here)) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]);
  }, [data, state.selected, state.genus]); // eslint-disable-line react-hooks/exhaustive-deps
  // start with the whole world (a selection is always in it); continents and zones narrow it down
  const [region, setRegion] = useState<Region>({ kind: "world" });
  const [zoneKm, setZoneKm] = useState(1000);
  const [lineage, setLineage] = useState<string | null>(null);
  const [diet, setDiet] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("first");
  const [hover, setHover] = useState<string | null>(null);
  const [others, setOthers] = useState(true);              // list genera outside the app's families too
  const [pinned, setPinned] = useState<Pinned | null>(null);
  useEffect(() => { if (state.selected) setPinned(null); }, [state.selected, state.genus]);

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
  const known = (fo: Fossil) => !!fo.family && famBy.has(fo.family);
  const found = useMemo(() => data.fossils.filter((fo) => (others || known(fo)) && inRegion(fo)),
    [data, famBy, region, others]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- one row per genus: its oldest and youngest fossil here ---------- */
  const rows = useMemo(() => {
    const by = new Map<string, Row>();
    for (const fo of found) {
      const r = by.get(fo.genus);
      if (r) { r.first = Math.max(r.first, fo.mid); r.last = Math.min(r.last, fo.mid); r.n++; }
      else {
        const f = fo.family ? famBy.get(fo.family) ?? null : null;
        by.set(fo.genus, { g: f ? genusBy.get(fo.genus) ?? null : null, genus: fo.genus, f, pfam: fo.family, first: fo.mid, last: fo.mid, n: 1 });
      }
    }
    const needle = q.trim().toLowerCase();
    // lineage and diet are only known for the app's families: those filters keep only them
    const out = [...by.values()].filter((r) =>
      (!lineage || (!!r.f && groupOf(r.f)?.key === lineage))
      && (!diet || (!!r.f && (r.f.pbdb?.diet ?? "none") === diet))
      && (!needle || r.genus.toLowerCase().includes(needle) || (r.pfam ?? "").toLowerCase().includes(needle)));
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
      if (!fo.here || !(others || known(fo))) continue;
      let site = m.get(fo.loc);
      if (!site) {
        const p = proj(fo.here);
        if (!p) continue;
        m.set(fo.loc, (site = { xy: p as [number, number], inside: inRegion(fo), genera: new Set(), families: new Set() }));
      }
      site.genera.add(fo.genus);
      if (fo.family) site.families.add(fo.family);
    }
    return [...m.values()];
  }, [data, famBy, proj, region, others]); // eslint-disable-line react-hooks/exhaustive-deps
  const lit = hover ?? pinned?.genus ?? state.genus;
  const litFamily = !hover && !pinned && !state.genus ? state.selected : null; // a family selection lights all its sites
  const isLit = (site: { genera: Set<string>; families: Set<string> }) => (lit ? site.genera.has(lit) : !!litFamily && site.families.has(litFamily));
  const zonePath = region.kind === "zone" ? path(geoCircle().center([region.lon, region.lat]).radius(region.km / 111.2)()) ?? "" : "";

  const clickMap = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ll = proj.invert?.([((e.clientX - r.left) / r.width) * mapW, ((e.clientY - r.top) / r.height) * mapH]);
    if (!ll || !Number.isFinite(ll[0])) return;
    const at: [number, number] = [ll[0], ll[1]];
    const near = HOTSPOTS.map((h) => ({ h, d: km(at, h.at) })).sort((a, b) => a.d - b.d)[0];
    setRegion({ kind: "zone", lon: at[0], lat: at[1], km: zoneKm, near: near.d <= NEAR_KM ? near.h.name : undefined });
  };
  const pickSpot = (name: string) => {
    const h = HOTSPOTS.find((x) => x.name === name);
    if (h) setRegion({ kind: "zone", lon: h.at[0], lat: h.at[1], km: zoneKm, spot: h.name });
  };
  // the zone's name, drawn just above its circle (or below, when the circle touches the top of the map)
  const zoneLabel = (() => {
    if (region.kind !== "zone") return null;
    const name = region.spot ?? (region.near && `Near ${region.near}`);
    const c = proj([region.lon, region.lat]), top = proj([region.lon, Math.min(89, region.lat + region.km / 111.2)]);
    if (!name || !c || !top) return null;
    const below = top[1] < 16, r = c[1] - top[1];
    return { name, x: Math.min(mapW - 70, Math.max(70, c[0])), y: below ? c[1] + r + 14 : top[1] - 6 };
  })();
  const setZone = (k: number) => { setZoneKm(k); if (region.kind === "zone") setRegion({ ...region, km: k }); };

  /** A suggestion was picked: select it and go where most of its fossils are. */
  const pick = (sg: Suggestion) => {
    setQ(""); setLineage(null); setDiet(null);
    if (sg.outside) { setOthers(true); setPinned({ genus: sg.genus!, family: sg.family || null }); }
    else dispatch(sg.genus ? { type: "genus", family: sg.family, genus: sg.genus } : { type: "select", family: sg.family });
    const n = new Map<string, number>();
    for (const fo of data.fossils) if (fo.here && (sg.outside ? fo.genus === sg.genus : fo.family === sg.family && (!sg.genus || fo.genus === sg.genus))) n.set(continentOf(fo.here), (n.get(continentOf(fo.here)) ?? 0) + 1);
    const best = [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
    const here = region.kind === "world" || (region.kind === "continent" && n.has(region.name));
    if (best && !here) setRegion({ kind: "continent", name: best });
  };

  /* ---------- the selection in the list: highlighted, and scrolled into view ---------- */
  const isSelRow = (r: Row) => pinned ? r.genus === pinned.genus
    : !!state.selected && r.f?.family === state.selected && (!state.genus || r.genus === state.genus);
  const firstSel = rows.find(isSelRow);
  const selRef = useRef<HTMLButtonElement | null>(null);
  // the list is one Tab stop: ↑ ↓ move between rows, Page Up/Down by ten, Home/End, Enter opens (a listbox)
  const [rowKey, setRowKey] = useState<string | null>(null);
  const rowEls = useRef(new Map<string, HTMLButtonElement>());
  // bring the selection into the list's view (scrolling the list, not scrollIntoView: see revealInScroller)
  useEffect(() => { revealInScroller(selRef.current); }, [state.selected, state.genus, pinned, region]);

  /* ---------- the list's time axis ---------- */
  const listWrap = useRef<HTMLDivElement>(null);
  const listW = useWidth(listWrap, 480);
  const LABEL = Math.min(210, Math.max(150, listW * 0.38));
  const x = scaleLinear().domain(TIME).range([LABEL + 6, listW - 34]);

  const title = region.kind === "world" ? "The whole world" : region.kind === "continent" ? region.name
    : region.spot ? `${region.spot} · ${fNum(region.km)} km`
      : `${fNum(region.km)} km around ${Math.abs(region.lat).toFixed(0)}°${region.lat >= 0 ? "N" : "S"}, ${Math.abs(region.lon).toFixed(0)}°${region.lon >= 0 ? "E" : "W"}${region.near ? ` · near ${region.near}` : ""}`;
  const mapLabel = `Today's world with every dinosaur fossil site. Showing ${region.kind === "world" ? "the whole world" : region.kind === "zone" ? `a zone: ${title}` : region.name}, ${fNum(found.length)} fossils. Click to pick a zone, or choose a hotspot below.`;
  const nFamilies = new Set(rows.map((r) => r.pfam).filter(Boolean)).size;
  const nOutside = rows.filter((r) => !r.f).length;

  const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) =>
    <button className={`${s.chip} ${on ? s.chipOn : ""}`} aria-pressed={on} onClick={onClick}>{children}</button>;

  const tabRow = (rowKey && rows.some((r) => r.genus === rowKey) ? rowKey : null) ?? firstSel?.genus ?? rows[0]?.genus;
  const keys = useKeysHint(); // the reminder of the keys, when the list gets the keyboard focus
  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = rows.findIndex((r) => r.genus === tabRow);
    const to: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, PageDown: i + 10, PageUp: i - 10, Home: 0, End: rows.length - 1 };
    if (!(e.key in to)) return;
    e.preventDefault();
    const r = rows[Math.max(0, Math.min(rows.length - 1, to[e.key]))];
    if (!r) return;
    setRowKey(r.genus);
    const el = rowEls.current.get(r.genus);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  };
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
            aria-label={mapLabel}>
            <path className={s.sphere} d={path({ type: "Sphere" }) ?? ""} />
            <path className={s.graticule} d={path(geoGraticule10()) ?? ""} />
            {land && <path className={s.land} d={path(land) ?? ""} />}
            {zonePath && <path className={s.zone} d={zonePath} />}
            {zoneLabel && <text className={s.zoneLabel} x={zoneLabel.x} y={zoneLabel.y}>{zoneLabel.name}</text>}
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
          <label className={s.sort} htmlFor="fg-zone">Zone
            <select id="fg-zone" className="select" value={region.kind === "zone" && region.spot ? region.spot : ""} onChange={(e) => pickSpot(e.target.value)}>
              <option value="" disabled>{region.kind === "zone" ? "Custom zone" : "Pick a fossil hotspot"}</option>
              {HOTSPOT_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {HOTSPOTS.filter((h) => h.group === g).map((h) => <option key={h.name} value={h.name}>{h.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <span>or click the map · size</span>
          <span className={`${s.seg} segmented`} role="group" aria-label="Zone size">
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
          <label className={s.othersToggle}>
            <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />
            Include families not in the timeline{others && nOutside > 0 && <span> · {fNum(nOutside)} genera</span>}
          </label>
        </header>
        <div className={s.filters}>
          <Search value={q} onChange={setQ} onPick={pick} />
          <div className={s.row}>
            {GROUPS.map((g) => <Chip key={g.key} on={lineage === g.key} onClick={() => setLineage(lineage === g.key ? null : g.key)}>{g.label}</Chip>)}
            <span className={s.divider} />
            <Chip on={diet === "herbivore"} onClick={() => setDiet(diet === "herbivore" ? null : "herbivore")}><i className="swatch swatch-herb" />Plant-eaters</Chip>
            <Chip on={diet === "carnivore"} onClick={() => setDiet(diet === "carnivore" ? null : "carnivore")}><i className="swatch swatch-carn" />Meat-eaters</Chip>
            <span className={s.spacer} />
            <label className={s.sort} htmlFor="fg-sort">Sort
              <select id="fg-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
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
              // the full name if it fits, else its first three letters, else nothing
              const label = x1 - x0 > name.length * 6.5 + 8 ? name : x1 - x0 > 26 ? name.slice(0, 3) : "";
              return label ? <text key={name} x={(x0 + x1) / 2} y={13} className={s.bandLabel}><title>{name}</title>{label}</text> : null;
            })}
            <line x1={x(state.t)} x2={x(state.t)} y1={0} y2={26} className={s.cursor} />
          </svg>
        </div>

        <div className={s.list}>
          {/* the selection: where it is in this list, or where else to look for it */}
          {state.selected && !pinned && !rows.some(isSelRow) && (
            <div className={s.notice}>
              <b>{state.genus ? <i>{state.genus}</i> : state.selected}</b>{" "}
              {selWhere.length === 0 ? "has no fossil sites on the map." : <>has no fossils {region.kind === "zone" ? "in this zone" : `in ${title}`}{q || lineage || diet ? " that match the filters" : ""}. Found in{" "}
                {selWhere.slice(0, 3).map(([c, n], i) => (
                  <span key={c}>{i > 0 && ", "}<button onClick={() => { setRegion({ kind: "continent", name: c }); setQ(""); setLineage(null); setDiet(null); }}>{c} ({fNum(n)})</button></span>
                ))}.</>}
            </div>
          )}
          {rows.length === 0 && <p className={s.empty}>No dinosaur fossils match here. Try a bigger zone or another place.</p>}
          <div role="listbox" aria-label={`Dinosaurs found ${region.kind === "world" ? "worldwide" : `in ${title}`}`} aria-describedby="guide-keys"
            onKeyDown={(e) => { keys.handlers.keyed(); onListKey(e); }} onFocus={keys.handlers.onFocus} onBlur={keys.handlers.onBlur}>
          {rows.map((r) => {
            const own = r.g?.phylopic?.svg, sil = own ?? r.f?.phylopic?.svg;
            const sel = isSelRow(r);
            const famLabel = r.f ? r.f.family : r.pfam ? `${r.pfam} · no profile` : "family unknown · no profile";
            return (
              <button key={r.genus} role="option" aria-selected={sel} tabIndex={r.genus === tabRow ? 0 : -1}
                ref={(el) => { if (el) rowEls.current.set(r.genus, el); else rowEls.current.delete(r.genus); if (sel && r === firstSel) selRef.current = el; }}
                onFocusCapture={() => setRowKey(r.genus)} className={`${s.item} ${sel ? s.itemSel : ""} ${r.f ? "" : s.itemOther}`} style={{ ["--lw" as string]: `${LABEL}px` }}
                onMouseEnter={() => setHover(r.genus)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(r.genus)} onBlur={() => setHover(null)}
                onClick={() => (!r.f ? setPinned(pinned?.genus === r.genus ? null : { genus: r.genus, family: r.pfam })
                  : r.g ? dispatch({ type: "genus", family: r.f.family, genus: r.genus }) : dispatch({ type: "select", family: r.f.family }))}
                title={`${r.genus} · ${famLabel} · ${fNum(r.n)} ${r.n === 1 ? "fossil" : "fossils"} here, ${fMa(Math.round(r.first * 10) / 10)}–${fMa(Math.round(r.last * 10) / 10)} Ma${r.f ? "" : " · no profile in this app"}`}>
                <span className={s.label}>
                  <i className={`${s.sil} ${own ? "" : s.silBorrowed} ${sil ? "" : s.silNone}`} style={sil ? { ["--src" as string]: `url("${silhouetteUrl(sil)}")` } : undefined}
                    title={own ? undefined : sil ? "Family silhouette: there is no drawing of this genus" : undefined} />
                  <span className={s.names} title={`${r.genus} · ${famLabel}`}><i>{r.genus}</i><small>{famLabel}</small></span>
                </span>
                <svg className={s.bar} width={listW - LABEL} height={22} viewBox={`${LABEL} 0 ${listW - LABEL} 22`}>
                  <line x1={x(state.t)} x2={x(state.t)} y1={0} y2={22} className={s.cursorFaint} />
                  <rect x={x(r.first) - 1.5} width={Math.max(3, x(r.last) - x(r.first) + 3)} y={8} height={6} rx={3} style={paint(r.f ? dietOf(r.f) : DIET.none)} />
                  <text x={Math.max(x(r.first), x(r.last)) + 8} y={14.5} className={s.n}>{fNum(r.n)}</text>
                </svg>
              </button>
            );
          })}
          </div>
          <KeysHint id="guide-keys" show={keys.show}>
            <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Page Up</kbd> <kbd>Page Down</kbd> by ten · <kbd>Enter</kbd> opens
          </KeysHint>
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
            return <rect key={`${b.start}${k}`} x={x(b.start)} width={w} y={yy} height={h} style={paint(k === "herb" ? DIET.herbivore : k === "carn" ? DIET.carnivore : DIET.none)} />;
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
interface Suggestion { kind: "genus" | "family" | "species"; label: string; family: string; genus?: string; sil?: string | null; own: boolean; note: string; outside?: boolean }

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
    // genera outside the app's families: they have fossils on the map, but no profile
    const inApp = new Set(out.filter((x) => x.kind === "genus").map((x) => x.label));
    const seen = new Set<string>();
    for (const fo of data.fossils) {
      if (inApp.has(fo.genus) || seen.has(fo.genus)) continue;
      seen.add(fo.genus);
      out.push({ kind: "genus", label: fo.genus, family: fo.family ?? "", genus: fo.genus, sil: null, own: false, outside: true,
        note: fo.family ? `${fo.family} · not in the timeline` : "family unknown" });
    }
    return out;
  }, [data]);
  const needle = value.trim().toLowerCase();
  const hits = useMemo(() => {
    if (needle.length < 2) return [];
    const rank = { genus: 0, family: 1, species: 2 } as const;
    return all.map((sg) => ({ sg, sc: score(sg.label, needle) })).filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc || Number(!!a.sg.outside) - Number(!!b.sg.outside) || rank[a.sg.kind] - rank[b.sg.kind] || a.sg.label.length - b.sg.label.length)
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
      <input className={s.search} type="search" placeholder="Find a dinosaur, family or species…" aria-label="Find a dinosaur, family or species" value={value} autoComplete="off"
        role="combobox" aria-expanded={show} aria-controls="fg-suggest" aria-autocomplete="list"
        aria-activedescendant={show ? `fg-sg-${active}` : undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey} />
      {show && (
        <ul id="fg-suggest" role="listbox" className={s.suggest}>
          {hits.map((sg, i) => (
            <li key={`${sg.kind}-${sg.label}-${sg.genus ?? ""}`} id={`fg-sg-${i}`} role="option" aria-selected={i === active}
              className={i === active ? s.sgOn : undefined} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(sg); }}>
              <i className={`${s.sgSil} ${sg.own ? "" : s.silBorrowed} ${sg.sil ? "" : s.silNone}`} style={sg.sil ? { ["--src" as string]: `url("${silhouetteUrl(sg.sil)}")` } : undefined} />
              <span className={s.sgName}>{sg.kind === "family" ? mark(sg.label) : <i>{mark(sg.label)}</i>}</span>
              <span className={s.sgNote}>{sg.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
