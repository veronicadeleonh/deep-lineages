/* Helpers shared by the tokens page (/#tokens) and the token lab (dev only): read the tokens on :root, measure WCAG
   contrast, and highlight the elements that use a token. */
export type Token = { name: string; raw: string; value: string; group: string };

/** Every custom property declared on :root, in the order it is written. */
export function readTokens(): Token[] {
  const out: Token[] = [];
  const cs = getComputedStyle(document.documentElement);
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSStyleRule) || r.selectorText !== ":root") continue;
      for (const prop of Array.from(r.style)) {
        if (!prop.startsWith("--") || prop.startsWith("--lightningcss")) continue; // skip the build tool's own
        const raw = r.style.getPropertyValue(prop).trim();
        out.push({ name: prop, raw, value: cs.getPropertyValue(prop).trim(), group: groupOf(prop, raw) });
      }
    }
  }
  return out;
}

function groupOf(name: string, raw: string): string {
  if (name.startsWith("--fs-")) return "Type scale";
  if (name.startsWith("--fw-")) return "Font weight";
  if (name.startsWith("--radius")) return "Radius";
  if (name.startsWith("--border-")) return "Border width";
  if (name.startsWith("--space-")) return "Spacing";
  if (name.startsWith("--dur-") || name.startsWith("--ease-")) return "Motion";
  if (name.startsWith("--tracking-")) return "Letter spacing";
  if (name.startsWith("--lh-")) return "Line height";
  if (name.startsWith("--z-")) return "Layer (z-index)";
  if (name.startsWith("--focus-")) return "Focus";
  if ((name.startsWith("--shadow") && name !== "--shadow-color") || name === "--map-halo") return "Shadow";
  if (name === "--font" || name === "--mono") return "Font family";
  const color = CSS.supports("color", raw) || /^var\(|^color-mix/.test(raw);
  if (color && /^--[a-z]+-\d+$/.test(name) && !raw.startsWith("var(")) return "Primitive colors"; // --gray-100, --amber-600…
  if (color) return "Semantic colors";
  return "Other";
}


/* ---------- contrast (WCAG 2.x) ---------- */
export const isColor = (group: string) => group.endsWith("colors");

export function toRgb(cssColor: string, probe: HTMLElement): [number, number, number, number] | null {
  probe.style.color = "";
  probe.style.color = cssColor;
  const c = getComputedStyle(probe).color;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  const m2 = c.match(/color\(srgb ([^)]+)\)/); // what color-mix() resolves to
  if (m2) {
    const p = m2[1].split(/[ /]+/).filter(Boolean).map(Number);
    return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
  }
  return null;
}
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** APCA (the contrast method drafted for WCAG 3), as |Lc|. Unlike the WCAG 2 ratio it knows that dark text on a
    mid tone reads worse than the ratio suggests. Text on the background `bg`. */
export function apcaLc(txt: number[], bg: number[]) {
  const y = ([r, g, b]: number[]) => 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
  const clamp = (v: number) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const t = clamp(y(txt)), b = clamp(y(bg));
  const s = b > t ? (b ** 0.56 - t ** 0.57) * 1.14 : (b ** 0.65 - t ** 0.62) * 1.14;
  return Math.abs(s) < 0.1 ? 0 : (Math.abs(s) - 0.027) * 100;
}
/** The APCA level we hold text to, on top of WCAG 2 (a check, not a rule): small labels 60, large text 45. */
export const NEED_LC: Partial<Record<Role, number>> = { text: 60, "large text": 45 };
export const toHex = (c: number[]) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/* ---------- highlight the elements that use a token ---------- */
const HIT = "data-token-hit";
let hitStyle: HTMLStyleElement | null = null;
export const tokenRe = (name: string) => new RegExp(`var\\(\\s*${name.replace(/-/g, "\\-")}\\s*[,)]`);

/** Marks every element on screen whose CSS (or inline style) uses the token. Returns the selectors and counts. */
export function findToken(name: string) {
  clearTokens();
  if (!hitStyle) {
    hitStyle = document.createElement("style");
    hitStyle.textContent = `[${HIT}] { outline: 2px solid magenta !important; outline-offset: 2px; }
      svg [${HIT}] { fill: magenta !important; stroke: magenta !important; opacity: 1 !important; }`;
    document.head.appendChild(hitStyle);
  }
  const re = tokenRe(name);
  const hits: { selector: string; onScreen: number }[] = [];
  const outside = (el: Element) => !el.closest("[data-token-lab]");
  const mark = (els: Element[]) => els.forEach((el) => el.setAttribute(HIT, ""));
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule) {
        if (r.selectorText === ":root" || !re.test(r.style.cssText)) continue;
        let els: Element[] = [];
        try { els = Array.from(document.querySelectorAll(r.selectorText)).filter(outside); } catch { /* selector the DOM can't query */ }
        mark(els);
        hits.push({ selector: r.selectorText, onScreen: els.length });
      } else if ("cssRules" in r) walk((r as CSSGroupingRule).cssRules);
    }
  };
  for (const sh of Array.from(document.styleSheets)) { try { walk(sh.cssRules); } catch { /* cross-origin sheet */ } }
  const inline = Array.from(document.querySelectorAll("[style]")).filter((el) => outside(el) && re.test(el.getAttribute("style") ?? ""));
  mark(inline);
  if (inline.length) hits.push({ selector: "(inline style)", onScreen: inline.length });
  // SVG attributes set from the TSX, like fill="var(--herb)"
  const attrs = Array.from(document.querySelectorAll("[fill], [stroke]"))
    .filter((el) => outside(el) && (re.test(el.getAttribute("fill") ?? "") || re.test(el.getAttribute("stroke") ?? "")));
  mark(attrs);
  if (attrs.length) hits.push({ selector: "(svg fill / stroke)", onScreen: attrs.length });
  return hits;
}
export function clearTokens() {
  document.querySelectorAll(`[${HIT}]`).forEach((el) => el.removeAttribute(HIT));
}

/* ---------- what each semantic color is for: the role sets the WCAG requirement, `on` the backgrounds it really sits on ---------- */
export type Role = "text" | "large text" | "graphic" | "background" | "decorative" | "disabled";
export const NEED: Record<Role, number> = { text: 4.5, "large text": 3, graphic: 3, background: 0, decorative: 0, disabled: 0 };
export const ROLE_HELP: Record<Role, string> = {
  text: "Text at normal size: 4.5:1 (WCAG 1.4.3)",
  "large text": "Text ≥24px, or ≥18.66px bold: 3:1 (WCAG 1.4.3)",
  graphic: "Icons, data marks, UI edges, focus rings: 3:1 against what's next to them (WCAG 1.4.11)",
  background: "A surface others sit on: measured from the other side",
  decorative: "Doesn't carry information on its own: no requirement",
  disabled: "Inactive controls: WCAG 1.4.3 exempts them, so they can look faded",
};
export type RoleInfo = { role: Role; on?: string[]; note?: string; inverse?: boolean }; // inverse: a background, measured against the text on it
const PAPER = ["--bg", "--surface", "--surface-2"];
const MAP = ["--surface", "--ocean", "--land"]; // the time machine map sits on --surface, the globe is --ocean
export const ROLES: Record<string, RoleInfo> = {
  "--bg": { role: "background" },
  "--surface": { role: "background" },
  "--surface-2": { role: "background" },
  "--ocean": { role: "background" },
  "--land": { role: "background", note: "Land vs sea is decorative here: the fossils carry the data" },
  "--line": { role: "decorative", note: "Dividers and card edges. Needs 3:1 where it's the only edge that shows a control, like the search box" },
  "--text": { role: "text", on: [...PAPER, "--accent-soft"] },
  "--text-2": { role: "text", on: PAPER },
  "--text-3": { role: "text", on: PAPER },
  "--text-disabled": { role: "disabled" },
  "--surface-disabled": { role: "disabled" },
  "--cursor": { role: "graphic", on: ["--surface", "--bg", "--ocean"], note: "Also the big year on the map (large text)" },
  "--accent-text": { role: "text", on: ["--surface", "--bg"] },
  "--map-accent-text": { role: "text", on: MAP, note: "Chapter label and links over the map" },
  "--accent-soft": { role: "background", note: "The fill of what's chosen or active; the text on it is measured from the other side" },
  "--accent-edge": { role: "decorative", note: "Edge of an --accent-soft fill. The fill and the text already mark it, so the edge needs no 3:1" },
  "--scrim": { role: "decorative", note: "Dims the app behind a dialog; the dialog's own surface carries the contrast" },
  "--veil": { role: "background", note: "--surface at 85%, so text reads over the map" },
  "--accent-bg": { role: "text", on: ["--surface", "--bg"], inverse: true, note: "Measured against the light text on top of it" },
  "--map-ink": { role: "text", on: MAP, note: "The story told over the map" },
  "--map-ink-2": { role: "text", on: MAP },
  "--map-dot": { role: "graphic", on: MAP },
  "--dot": { role: "graphic", on: MAP, note: "Drawn at 55% opacity: the real contrast is lower" },
  "--area": { role: "decorative", note: "The fill under the curve; --area-edge carries the shape" },
  "--area-edge": { role: "graphic", on: ["--surface"] },
  "--diet-herb": { role: "graphic", on: ["--surface"], note: "Dots, lines, and the edge of herbivore areas" },
  "--diet-herb-fill": { role: "decorative", note: "Areas and bars: light, so the edge (--diet-herb) carries the 3:1" },
  "--diet-herb-on": { role: "text", on: ["--diet-herb-fill", "--diet-herb-hover"], note: "Family names on the herbivore arcs of the tree" },
  "--diet-herb-hover": { role: "background", note: "Herbivore arc under the pointer or selected: --diet-herb-on stays 4.5:1 on it" },
  "--diet-carn-hover": { role: "background", note: "Carnivore arc under the pointer or selected: --diet-carn-on stays 4.5:1 on it" },
  "--diet-carn": { role: "graphic", on: ["--surface"], note: "Dots, lines, and the edge of carnivore areas" },
  "--diet-carn-fill": { role: "decorative", note: "Areas and bars. Solid by default; if made lighter, the edge carries the 3:1" },
  "--diet-carn-on": { role: "text", on: ["--diet-carn-fill", "--diet-carn-hover"], note: "Family names on the carnivore arcs of the tree" },
  "--diet-other": { role: "graphic", on: ["--surface"], note: "Omnivores and no data: the edge, dots and lines" },
  "--diet-other-fill": { role: "decorative", note: "Areas and bars: light, so the edge (--diet-other) carries the 3:1" },
  "--diet-other-hover": { role: "background", note: "No-data arc under the pointer or selected: --diet-other-on stays 4.5:1 on it" },
  "--diet-other-on": { role: "text", on: ["--diet-other-fill", "--diet-other-hover"], note: "Family names on the no-data arcs of the tree" },
  "--extinct": { role: "text", on: ["--surface"], note: "Labels like “K-Pg extinction”. On the map they get a --surface halo, so they're measured against that too" },
  "--shadow-color": { role: "decorative", note: "Used at 8–18% opacity inside the --shadow-* tokens" },
  "--period-tri": { role: "graphic", on: ["--surface"] },
  "--period-jur": { role: "graphic", on: ["--surface"] },
  "--period-cre": { role: "graphic", on: ["--surface"] },
};

/** Every real pair for a semantic color, measured against its requirement. */
export function checkRole(name: string, probe: HTMLElement) {
  const info = ROLES[name];
  if (!info) return null;
  const need = NEED[info.role];
  const c = toRgb(`var(${name})`, probe);
  const pairs = (info.on ?? []).map((bg) => {
    const b = toRgb(`var(${bg})`, probe);
    const r = c && b ? ratio(c, b) : 0;
    const lc = c && b && NEED_LC[info.role] ? (info.inverse ? apcaLc(b, c) : apcaLc(c, b)) : null; // APCA cares which one is the text
    return { bg, r, pass: r >= need, lc, lcOk: lc == null || lc >= NEED_LC[info.role]! };
  });
  return { ...info, need, pairs, pass: pairs.every((p) => p.pass) };
}
