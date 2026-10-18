/* The design tokens, live: every custom property on :root, read from the browser (so it never drifts from the CSS),
   with where each one is used, WCAG contrast for the colors, and the raw values that still aren't tokens.
   Open it at /#tokens. */
import { useEffect, useMemo, useState } from "react";
import s from "./Tokens.module.css";
import { checkRole, isColor, ratio, readTokens, ROLE_HELP, toHex, toRgb, type Token } from "../tokenTools";

type Sources = Record<string, string>;

/* ---------- where things are used ---------- */
function countUses(src: Sources, name: string) {
  const re = new RegExp(`var\\(\\s*${name.replace(/[-]/g, "\\-")}\\s*[,)]`, "g");
  const files: { file: string; n: number }[] = [];
  for (const [file, text] of Object.entries(src)) {
    const n = (text.match(re) ?? []).length;
    if (n) files.push({ file, n });
  }
  return files.sort((a, b) => b.n - a.n);
}

/** Literal values written straight into the styles, outside the :root block. */
const RAW_CHECKS: { label: string; re: RegExp; hint: string; ignore?: RegExp }[] = [
  { label: "font-weight", re: /font-weight:\s*(\d+)/g, hint: "candidates for --fw-*" },
  { label: "border-radius", re: /border-radius:\s*([\d.]+px|999px|50%)/g, hint: "candidates for --radius-*" },
  { label: "colors", re: /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))/g, hint: "hex / rgb outside :root" },
  { label: "box-shadow", re: /box-shadow:\s*([^;}]+)/g, hint: "candidates for --shadow-*" },
  { label: "z-index", re: /z-index:\s*(\d+)/g, hint: "candidates for --z-*" },
  { label: "letter-spacing", re: /letter-spacing:\s*(-?[\d.]+em)/g, hint: "candidates for --tracking-*" },
  { label: "line-height", re: /line-height:\s*([\d.]+)(?![\w%])/g, hint: "candidates for --lh-*" },
  { label: "spacing", re: /(?<![\w-])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?:\s*([^;}]*\dpx[^;}]*)/g, hint: "candidates for --space-* (1–3px tweaks inside small controls don't count)", ignore: /(?<![\w.])-?[13]px\b/g },
  { label: "border-width", re: /(?:border(?:-(?:top|right|bottom|left))?(?:-width)?|outline(?:-width)?):\s*(?:[^;}]*\s)?([1-9][\d.]*px|0?\.\d+px)/g, hint: "candidates for --border-*" },
];
function rawValues(src: Sources) {
  return RAW_CHECKS.map(({ label, re, hint, ignore }) => {
    const found = new Map<string, Map<string, number>>();
    for (const [file, full] of Object.entries(src)) {
      const text = full.replace(/:root\s*\{[^}]*\}/, "").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of text.matchAll(re)) {
        const v = m[1].trim();
        const rest = v.replace(ignore ?? /$^/g, "").replace(/var\(--[\w-]+\)/g, "").replace(/\b0\b/g, "");
        if (!rest.trim() || (ignore && !/\dpx/.test(rest))) continue; // only tokens, zeros (and allowed tweaks): already tokenized
        const per = found.get(v) ?? new Map<string, number>();
        per.set(file, (per.get(file) ?? 0) + 1);
        found.set(v, per);
      }
    }
    const rows = [...found].map(([value, per]) => ({
      value, total: [...per.values()].reduce((a, b) => a + b, 0), files: [...per].map(([f, n]) => `${f} ×${n}`),
    })).sort((a, b) => b.total - a.total);
    return { label, hint, rows };
  });
}

export function Tokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [src, setSrc] = useState<Sources>({});
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setTokens(readTokens()); }, []);
  useEffect(() => {
    // the app's own source, loaded only on this page (it stays out of the app's bundle)
    const mods = import.meta.glob("../**/*.{css,tsx,ts}", { query: "?raw", import: "default" });
    Promise.all(Object.entries(mods).map(async ([p, load]) => [p.replace(/^\.\//, "components/").replace(/^\.\.\//, ""), (await load()) as string] as const))
      .then((all) => setSrc(Object.fromEntries(all.filter(([p]) => !/Tokens\.|TokenLab|tokenTools/.test(p)))));
  }, []);

  const probe = useMemo(() => { const d = document.createElement("span"); d.style.display = "none"; document.body.appendChild(d); return d; }, []);
  const bgs = useMemo(() => ["--bg", "--surface"].map((n) => ({ n, c: toRgb(`var(${n})`, probe) })), [probe, tokens]);
  const groups = useMemo(() => {
    const g = new Map<string, Token[]>();
    for (const t of tokens) g.set(t.group, [...(g.get(t.group) ?? []), t]);
    return ["Semantic colors", "Primitive colors", "Type scale", "Font weight", "Letter spacing", "Line height", "Font family", "Radius", "Border width", "Spacing", "Shadow", "Focus", "Layer (z-index)", "Other"].filter((k) => g.has(k)).map((k) => [k, g.get(k)!] as const);
  }, [tokens]);
  const raw = useMemo(() => rawValues(src), [src]);
  const loaded = Object.keys(src).length > 0;

  /** the semantic tokens that point at a primitive */
  const refsOf = (name: string) => tokens.filter((x) => x.raw.includes(`var(${name})`)).map((x) => x.name);
  const uses = (t: Token) => {
    if (!loaded) return null;
    const f = countUses(src, t.name);
    const n = f.reduce((a, b) => a + b.n, 0);
    return (
      <td className={s.uses}>
        <button className={n ? s.usesBtn : `${s.usesBtn} ${s.unused}`} onClick={() => setOpen(open === t.name ? null : t.name)} disabled={!n}>
          {n ? `${n} use${n > 1 ? "s" : ""}` : "unused"}
        </button>
        {open === t.name && <ul className={s.files}>{f.map((x) => <li key={x.file}>{x.file} <b>×{x.n}</b></li>)}</ul>}
      </td>
    );
  };

  return (
    <main className={s.page}>
      <header className={s.head}>
        <p className={s.eyebrow}>🦕 Deep Lineages</p>
        <h1>Design tokens</h1>
        <p className={s.lede}>
          Every custom property on <code>:root</code>, read live from the browser. Edit <code>global.css</code> and this
          page follows. <a href="#">← Back to the app</a>
        </p>
        <nav className={s.toc}>{groups.map(([g]) => <a key={g} href={`#tokens-${g}`} onClick={(e) => { e.preventDefault(); document.getElementById(`t-${g}`)?.scrollIntoView({ behavior: "smooth" }); }}>{g}</a>)}
          <a href="#tokens-raw" onClick={(e) => { e.preventDefault(); document.getElementById("t-raw")?.scrollIntoView({ behavior: "smooth" }); }}>Not tokenized yet</a></nav>
      </header>

      {groups.map(([g, list]) => (
        <section key={g} id={`t-${g}`} className={s.section}>
          <h2>{g} <span>{list.length}</span></h2>
          {INTRO[g] && <p className={s.note}>{INTRO[g]}</p>}
          {g === "Semantic colors" && <Failures names={list.map((x) => x.name)} probe={probe} />}
          <table className={s.table}>
            <thead>
              <tr>
                <th>Token</th><th>Preview</th><th>Value</th>
                {g === "Semantic colors" && <><th>Role</th><th>Contrast where it's used</th></>}
                {g === "Primitive colors" && <th title="For reference only: whether a color passes depends on how a semantic token uses it">Contrast on --bg / --surface</th>}
                <th>{g === "Primitive colors" ? "Referenced by" : "Used"}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => {
                const c = isColor(g) ? toRgb(`var(${t.name})`, probe) : null;
                return (
                  <tr key={t.name}>
                    <td><code className={s.name}>{t.name}</code></td>
                    <td className={s.preview}>{preview(g, t)}</td>
                    <td className={s.value}>
                      <code>{t.raw}</code>
                      {t.raw !== t.value && <small>→ {t.value}</small>}
                      {c && !t.value.startsWith("#") && <small>→ {toHex(c)}{(c[3] ?? 1) < 1 ? ` at ${Math.round((c[3] ?? 1) * 100)}%` : ""}</small>}
                    </td>
                    {g === "Semantic colors" && <RoleCells name={t.name} probe={probe} />}
                    {g === "Primitive colors" && <td className={s.ref}>{bgs.map((b) => c && b.c ? <span key={b.n}>{ratio(c, b.c).toFixed(2)}</span> : null)}</td>}
                    {g === "Primitive colors" ? <td className={s.refs}>{refsOf(t.name).length
                      ? refsOf(t.name).map((r) => <code key={r}>{r}</code>)
                      : <span className={s.unused}>not used yet</span>}</td>
                      : uses(t) ?? <td className={s.uses}>…</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <section id="t-raw" className={s.section}>
        <h2>Not tokenized yet</h2>
        <p className={s.note}>Literal values written straight into the styles (outside <code>:root</code>). Each one is a candidate for a token, or for merging into an existing one.</p>
        {!loaded ? <p className={s.note}>Reading the source…</p> : raw.map((r) => (
          <div key={r.label} className={s.raw}>
            <h3>{r.label} <span>{r.rows.length} distinct · {r.hint}</span></h3>
            {r.rows.length === 0 ? <p className={s.note}>All tokenized ✓</p> : (
              <table className={s.table}>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={x.value}>
                      <td className={s.rawVal}>{r.label === "colors" && <span className={s.dotSw} style={{ background: x.value }} />}<code>{x.value}</code></td>
                      <td className={s.count}>×{x.total}</td>
                      <td className={s.where}>{x.files.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}

const INTRO: Record<string, string> = {
  "Semantic colors": "Named for what they do. Components use only these. Each one points at a primitive, so changing the palette never means hunting through the components. Each has a role (hover it): the role sets what WCAG asks of it, measured against the backgrounds it really sits on.",
  "Primitive colors": "The palette, named for what each color looks like (50 is near white, 900 near black). Components never use them directly: only the semantic tokens do. Contrast here is for reference only: whether a color passes depends on the role of the semantic token that uses it.",
};

function preview(g: string, t: Token) {
  const v = `var(${t.name})`;
  if (isColor(g)) return <span className={s.sw} style={{ background: v }} />;
  if (g === "Type scale") return <span style={{ fontSize: v, lineHeight: 1.2 }}>Tyrannosaurus</span>;
  if (g === "Font weight") return <span style={{ fontWeight: v }}>Tyrannosaurus</span>;
  if (g === "Font family") return <span style={{ fontFamily: v }}>Tyrannosaurus 66 Ma</span>;
  if (g === "Radius") return <span className={s.box} style={{ borderRadius: v }} />;
  if (g === "Letter spacing") return <span style={{ letterSpacing: v, textTransform: t.name.includes("caps") ? "uppercase" : undefined, fontSize: "var(--fs-sm)" }}>{t.name.includes("caps") ? "On the map now" : "Tyrannosaurus"}</span>;
  if (g === "Line height") return <span style={{ display: "block", lineHeight: v, fontSize: "var(--fs-sm)", maxWidth: 180, background: "var(--surface-2)" }}>The Atlantic begins to open between two continents.</span>;
  if (g === "Focus") return focusPreview(t.name);
  if (g === "Spacing") return <span className={s.spaceBar} style={{ width: v }} />;
  if (g === "Border width") return <span className={s.box} style={{ borderWidth: v, borderColor: "var(--text)" }} />;
  if (g === "Shadow") return <span className={s.box} style={{ boxShadow: v, border: 0 }} />;
  return null;
}

/** Each focus token shows only its own part of the ring. */
function focusPreview(name: string) {
  if (name === "--focus-width") return <span className={s.focusBar} />;
  if (name === "--focus-ring") return <span className={`${s.box} ${s.focusBox}`} style={{ outline: "var(--focus-ring)" }} />;
  if (name === "--focus-offset") return (
    <span className={s.focusPair}>
      <span><span className={`${s.box} ${s.focusBox} ${s.focusGap}`} /><small>outside</small></span>
      <span><span className={`${s.box} ${s.focusBox} ${s.focusIn}`} /><small>inside × -1</small></span>
    </span>
  );
  return null;
}

/** Role and the real pairs for a semantic color, judged by what that role needs. */
function RoleCells({ name, probe }: { name: string; probe: HTMLElement }) {
  const r = checkRole(name, probe);
  if (!r) return <><td className={s.na}>—</td><td className={s.na}>no role yet</td></>;
  return (
    <>
      <td><span className={s.role} title={ROLE_HELP[r.role]}>{r.role}</span>{r.need > 0 && <small className={s.need}>needs {r.need}:1</small>}</td>
      <td>
        {r.pairs.length === 0 ? <span className={s.na}>not measured</span> : r.pairs.map((p) => (
          <span key={p.bg} className={`${s.cr} ${p.pass ? s.pass : s.fail}`}>on {p.bg} {p.r.toFixed(2)} <b>{p.pass ? "✓" : "✗"}</b>{p.lc != null && <i className={p.lcOk ? s.lc : s.lcLow} title="APCA (WCAG 3 draft): 60+ for small labels, 45+ for large text">Lc {Math.round(p.lc)}</i>}</span>
        ))}
        {r.note && <small className={s.roleNote}>{r.note}</small>}
      </td>
    </>
  );
}

/** The semantic colors that miss their requirement somewhere. */
function Failures({ names, probe }: { names: string[]; probe: HTMLElement }) {
  const bad = names.map((n) => ({ n, r: checkRole(n, probe) })).filter((x) => x.r && !x.r.pass);
  return bad.length === 0
    ? <p className={`${s.summary} ${s.summaryOk}`}>Every semantic color meets the requirement of its role ✓</p>
    : <p className={s.summary}><b>{bad.length} real failure{bad.length > 1 ? "s" : ""}:</b> {bad.map((x) => <code key={x.n}>{x.n}</code>)}</p>;
}
