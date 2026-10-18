/* The token lab (dev only): a floating panel over the app to try token values live. Change a color, alias it to
   another token, see the WCAG contrast update, and light up where it is used, while you move through the views.
   Changes live only in this browser until you copy them into global.css. Styled on its own, so it keeps working
   whatever you do to the tokens. */
import { useEffect, useMemo, useState } from "react";
import { checkRole, clearTokens, findToken, isColor, ratio, readTokens, toHex, toRgb } from "../tokenTools";

const KEY = "deep-lineages:token-lab";

/** Which tokens the panel lists. */
const KINDS = {
  Colors: (g: string) => isColor(g),
  "Font weight": (g: string) => g === "Font weight",
  "Type scale": (g: string) => g === "Type scale",
  "Letter spacing": (g: string) => g === "Letter spacing",
  "Line height": (g: string) => g === "Line height",
  Radius: (g: string) => g === "Radius",
  Shadow: (g: string) => g === "Shadow",
  "Border width": (g: string) => g === "Border width",
  Spacing: (g: string) => g === "Spacing",
  Motion: (g: string) => g === "Motion",
  All: () => true,
};
type Kind = keyof typeof KINDS;
const load = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const save = (o: Record<string, string>) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private mode */ } };
const root = document.documentElement;

export function TokenLab() {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState<Record<string, string>>(load);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("Colors");
  const [found, setFound] = useState<string | null>(null);
  const [onScreen, setOnScreen] = useState(0);
  const [copied, setCopied] = useState(false);

  // apply the overrides on top of global.css
  useEffect(() => {
    for (const [k, v] of Object.entries(over)) root.style.setProperty(k, v);
    save(over);
  }, [over]);
  const set = (name: string, v: string) => setOver((o) => ({ ...o, [name]: v }));
  const reset = (name: string) => { root.style.removeProperty(name); setOver(({ [name]: _, ...o }) => o); };
  const resetAll = () => { for (const k of Object.keys(over)) root.style.removeProperty(k); setOver({}); };

  // keep the highlight on while you move through the app
  useEffect(() => {
    if (!found) { clearTokens(); return; }
    const run = () => setOnScreen(findToken(found).reduce((n, h) => n + h.onScreen, 0));
    run();
    const id = setInterval(run, 700);
    return () => { clearInterval(id); clearTokens(); };
  }, [found]);

  // semantic first: that's what you'll tune most; the primitives after
  const tokens = useMemo(() => (open ? readTokens().sort((a, b) => +(a.group === "Primitive colors") - +(b.group === "Primitive colors")) : []), [open]);
  const probe = useMemo(() => { const d = document.createElement("span"); d.style.display = "none"; d.dataset.tokenLab = ""; document.body.appendChild(d); return d; }, []);
  const rgb = (n: string) => toRgb(`var(${n})`, probe);
  const bg = rgb("--bg"), surface = rgb("--surface");
  const list = tokens.filter((t) => KINDS[kind](t.group) && t.name.includes(q.trim()));
  const changed = Object.keys(over).length;

  const copy = () => {
    const css = Object.entries(over).map(([k, v]) => `  ${k}: ${v};`).join("\n");
    navigator.clipboard?.writeText(css).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  if (!open) return (
    <button data-token-lab style={{ ...st.fab, ...(changed ? st.fabOn : null) }} onClick={() => setOpen(true)} title="Token lab (dev only)">
      🎨 Tokens{changed ? ` · ${changed} changed` : ""}
    </button>
  );

  return (
    <aside data-token-lab style={st.panel} aria-label="Token lab">
      <div style={st.head}>
        <b>🎨 Token lab</b>
        <span style={st.dim}>dev only</span>
        <button style={{ ...st.btn, marginLeft: "auto" }} onClick={() => setOpen(false)} aria-label="Close">✕</button>
      </div>
      <div style={st.bar}>
        <input style={st.search} placeholder="Filter: --text, --map…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={st.select} value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Which tokens">
          {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k}>{k}</option>)}
        </select>
      </div>
      <div style={st.bar}>
        <button style={st.btn} onClick={copy} disabled={!changed}>{copied ? "Copied ✓" : `Copy changes (${changed})`}</button>
        <button style={st.btn} onClick={resetAll} disabled={!changed}>Reset all</button>
        {found && <span style={st.found}>🔍 {found}: {onScreen} on screen <button style={st.link} onClick={() => setFound(null)}>clear</button></span>}
      </div>
      <div style={st.list}>
        {list.map((t) => {
          const cur = over[t.name] ?? t.raw;
          const c = isColor(t.group) ? rgb(t.name) : null;
          const isOn = found === t.name;
          return (
            <div key={t.name} style={{ ...st.row, ...(over[t.name] != null ? st.rowChanged : null) }}>
              {c ? (
                <label style={{ ...st.sw, background: `var(${t.name})` }} title="Pick a color">
                  <input type="color" value={toHex(c)} onChange={(e) => set(t.name, e.target.value)} style={st.hiddenInput} />
                </label>
              ) : t.group === "Shadow" ? <span style={{ ...st.swNone, height: 22, background: "#fff", borderRadius: 4, boxShadow: `var(${t.name})` }} aria-hidden />
                : t.group === "Radius" ? <span style={{ ...st.swNone, ...st.radiusBox, borderRadius: `var(${t.name})` }} aria-hidden />
                : t.group === "Font weight" ? <span style={{ ...st.swNone, ...st.aa, fontWeight: `var(${t.name})` }} aria-hidden>Aa</span>
                : t.group === "Spacing" ? <span style={{ ...st.swNone, display: "flex", alignItems: "center" }} aria-hidden><span style={{ width: `var(${t.name})`, height: 10, background: "#b57500" }} /></span>
                : <span style={st.swNone} />}
              <div style={st.mid}>
                <code style={st.name}>{t.name}</code>
                {t.group === "Font weight" ? (
                  <select style={st.val} value={cur} onChange={(e) => set(t.name, e.target.value)} title="IBM Plex Sans is loaded in these four weights">
                    {[...new Set(["400", "500", "600", "700", cur])].map((w) => <option key={w}>{w}</option>)}
                  </select>
                ) : <input style={st.val} defaultValue={cur} key={cur}
                  onKeyDown={(e) => { if (e.key === "Enter") set(t.name, (e.target as HTMLInputElement).value.trim()); }}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== cur) set(t.name, v); }} />}
              </div>
              <div style={st.cr}>
                {(() => {
                  if (!c) return null;
                  const r = checkRole(t.name, probe);
                  if (!r) return bg && surface ? <span style={st.dim} title="primitive: for reference, on --bg / --surface">{ratio(c, bg).toFixed(1)} / {ratio(c, surface).toFixed(1)}</span> : null;
                  if (!r.pairs.length) return <span style={st.dim}>{r.role}</span>;
                  const worst = r.pairs.reduce((a, b) => (b.r < a.r ? b : a));
                  return <>
                    <Badge r={worst.r} pass={r.pass} title={`${r.role}, needs ${r.need}:1\n` + r.pairs.map((p) => `on ${p.bg}: ${p.r.toFixed(2)}${p.lc != null ? ` · APCA Lc ${Math.round(p.lc)}` : ""}`).join("\n")} />
                    {(() => { const lcs = r.pairs.filter((p) => p.lc != null); if (!lcs.length) return null; const low = lcs.reduce((a, b) => (b.lc! < a.lc! ? b : a));
                      return <span style={{ ...st.dim, color: low.lcOk ? undefined : "#8f1538", fontWeight: low.lcOk ? undefined : 700 }} title="APCA (WCAG 3 draft), worst pair: 60+ for small labels">Lc {Math.round(low.lc!)}</span>; })()}
                    <span style={st.dim}>{r.role}</span>
                  </>;
                })()}
              </div>
              <button style={{ ...st.icon, ...(isOn ? st.iconOn : null) }} onClick={() => setFound(isOn ? null : t.name)} title="Show where it is used">🔍</button>
              <button style={{ ...st.icon, visibility: over[t.name] != null ? "visible" : "hidden" }} onClick={() => reset(t.name)} title={`Back to ${t.raw}`}>↺</button>
            </div>
          );
        })}
      </div>
      <p style={st.foot}>Type any CSS value or another token (<code>var(--line)</code>) and press Enter. Each color is judged by its role (hover the badge): text 4.5:1 · graphics & large text 3:1. The badge shows its worst real pair; for text, "Lc" is the APCA check (WCAG 3 draft, 60+), which catches dark text on mid tones.</p>
    </aside>
  );
}

function Badge({ r, pass, title }: { r: number; pass: boolean; title: string }) {
  const [bg, fg] = pass ? ["#dcf3e8", "#0b5c40"] : ["#fbe1e6", "#8f1538"];
  return <span style={{ ...st.badge, background: bg, color: fg }} title={title}>{r.toFixed(1)} {pass ? "✓" : "✗"}</span>;
}

/* its own styles, on purpose not tokens */
const font = '12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const st: Record<string, React.CSSProperties> = {
  fab: { position: "fixed", left: 16, bottom: 16, zIndex: 1000, font, fontWeight: 600, color: "#18222b", background: "#fff", border: "1px solid #c9d2d9", borderRadius: 8, padding: "6px 10px", cursor: "pointer", boxShadow: "0 4px 14px rgb(0 0 0 / .12)" },
  fabOn: { borderColor: "magenta" },
  panel: { position: "fixed", left: 16, bottom: 16, zIndex: 1000, width: 400, maxHeight: "75vh", display: "flex", flexDirection: "column", font, color: "#18222b", background: "#fff", border: "1px solid #c9d2d9", borderRadius: 10, boxShadow: "0 12px 40px rgb(0 0 0 / .2)" },
  head: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 6px", fontSize: 13 },
  dim: { color: "#5b6773", fontSize: 11 },
  bar: { display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", flexWrap: "wrap" },
  search: { flex: 1, font, padding: "4px 8px", border: "1px solid #c9d2d9", borderRadius: 6 },
  select: { font, padding: "3px 6px", border: "1px solid #c9d2d9", borderRadius: 6, background: "#fff" },
  radiusBox: { height: 22, background: "#eef2f4", border: "1.5px solid #6d8394" },
  aa: { fontSize: 16, lineHeight: "26px", textAlign: "center", color: "#18222b", fontFamily: "var(--font)" },
  check: { display: "inline-flex", alignItems: "center", gap: 4, color: "#3d4954" },
  btn: { font, color: "#18222b", background: "#f1f4f6", border: "1px solid #c9d2d9", borderRadius: 6, padding: "3px 8px", cursor: "pointer" },
  found: { color: "#8a0f8a", fontSize: 11 },
  link: { font, fontSize: 11, color: "#8a0f8a", background: "none", border: 0, padding: 0, textDecoration: "underline", cursor: "pointer" },
  list: { overflowY: "auto", padding: "4px 6px", borderTop: "1px solid #e3e8ec", borderBottom: "1px solid #e3e8ec" },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 6 },
  rowChanged: { background: "#fbeefb" },
  sw: { position: "relative", width: 26, height: 26, flex: "none", borderRadius: 5, border: "1px solid #c9d2d9", cursor: "pointer", overflow: "hidden" },
  swNone: { width: 26, flex: "none" },
  hiddenInput: { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" },
  mid: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  name: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, fontWeight: 600 },
  val: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, padding: "1px 4px", border: "1px solid transparent", borderRadius: 4, background: "#f6f8f9", width: "100%" },
  cr: { display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end", minWidth: 62 },
  badge: { fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "0 5px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  icon: { font, background: "none", border: "1px solid transparent", borderRadius: 6, padding: "2px 4px", cursor: "pointer" },
  iconOn: { borderColor: "magenta", background: "#fbeefb" },
  foot: { margin: 0, padding: "6px 12px 10px", color: "#5b6773", fontSize: 11 },
};
