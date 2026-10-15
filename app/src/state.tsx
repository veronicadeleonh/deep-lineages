import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { TIME } from "./constants";
import { isAlive, round1 } from "./format";
import type { AppData, LineageKey, Range } from "./types";

/** Everything the user can change. Time is in Ma (millions of years ago). */
export interface State {
  t: number;                 // cursor position
  selected: string | null;   // selected family
  genus: string | null;      // selected genus (within the selected family)
  expanded: string[];        // families the user unfolded into their genera
  collapsed: string[];       // families the user folded (overrides the automatic unfolding when zoomed in)
  view: Range;               // visible time window [older, younger]
  mode: "machine" | "timeline" | "tree" | "guide"; // which view of the data
  foldedLineages: LineageKey[]; // timeline: lineages collapsed into one row
  focusNow: boolean;         // timeline: collapse the families with no fossils at the cursor
}

export type Action =
  | { type: "time"; t: number }
  | { type: "toggleFamily"; family: string }   // select, or deselect if already selected
  | { type: "fold"; family: string; open: boolean } // unfold/fold without touching the selection
  | { type: "select"; family: string | null }  // select without touching the folds (panel chips)
  | { type: "genus"; family: string; genus: string }
  | { type: "clearGenus" }                     // back from a genus to its family
  | { type: "view"; view: Range }
  | { type: "mode"; mode: State["mode"] }
  | { type: "foldLineage"; lineage: LineageKey }
  | { type: "focusNow"; on: boolean };

export const MIN_SPAN = 3; // maximum zoom: 3 million years on screen

const clampT = (t: number) => round1(Math.max(TIME[1], Math.min(TIME[0], t)));

export function clampView([a, b]: Range): Range {
  const s = Math.min(TIME[0] - TIME[1], Math.max(MIN_SPAN, a - b));
  const c = Math.min(TIME[0] - s / 2, Math.max(TIME[1] + s / 2, (a + b) / 2));
  return [c + s / 2, c - s / 2];
}

/** Moves the time to `t`, panning the view if `t` falls outside it. */
function goTo(state: State, t: number): State {
  const view = state.view;
  if (t <= view[0] && t >= view[1]) return { ...state, t: clampT(t) };
  const s = view[0] - view[1];
  return { ...state, t: clampT(t), view: clampView([t + s / 2, t - s / 2]) };
}

function makeReducer(data: AppData) {
  const famRange = (name: string) => data.families.find((f) => f.family === name)?.range_ma;
  const mid = ([a, b]: Range) => (a + b) / 2;

  return function reducer(state: State, a: Action): State {
    switch (a.type) {
      case "time":
        return { ...state, t: clampT(a.t) };
      case "focusNow":
        return { ...state, focusNow: a.on };
      case "foldLineage": {
        const has = state.foldedLineages.includes(a.lineage);
        return { ...state, foldedLineages: has ? state.foldedLineages.filter((k) => k !== a.lineage) : [...state.foldedLineages, a.lineage] };
      }
      case "mode":
        return { ...state, mode: a.mode };
      case "view":
        return { ...state, view: clampView(a.view) };
      case "select":
      case "toggleFamily": {
        const deselect = a.family === null || state.selected === a.family;
        const fam = deselect ? null : a.family;
        let next: State = { ...state, selected: fam, genus: null }; // unfolding is separate (▸, or zooming in)
        const r = fam ? famRange(fam) : undefined;
        if (r && !isAlive(r, state.t)) next = goTo(next, mid(r)); // jump to when the family lived
        return next;
      }
      case "fold": {
        const without = (l: string[]) => l.filter((f) => f !== a.family);
        return a.open
          ? { ...state, expanded: [...without(state.expanded), a.family], collapsed: without(state.collapsed) }
          : { ...state, expanded: without(state.expanded), collapsed: [...without(state.collapsed), a.family] };
      }
      case "clearGenus":
        return { ...state, genus: null };
      case "genus": {
        const genus = state.genus === a.genus && state.selected === a.family ? null : a.genus;
        let next: State = { ...state, selected: a.family, genus };
        const g = data.genera[a.family]?.genera.find((x) => x.genus === genus);
        if (g && !isAlive(g.range_ma, state.t)) next = goTo(next, mid(g.range_ma));
        return next;
      }
    }
  };
}

const INITIAL: State = { t: 252, selected: null, genus: null, expanded: [], collapsed: [], view: [...TIME] as Range, mode: "machine", foldedLineages: [], focusNow: true };

/* ---------- the URL keeps where you are: a reload brings you back, and a link takes others there ----------
   ?view=timeline&family=Tyrannosauridae&genus=Tyrannosaurus&t=68&zoom=80-60 */
const VIEW_NAMES: Record<State["mode"], string> = { machine: "time-machine", timeline: "timeline", tree: "family-tree", guide: "field-guide" };

/** True when the address carries a place in the app (then the welcome screen steps aside). */
export const hasUrlState = () => { try { return new URLSearchParams(location.search).has("view"); } catch { return false; } };

function fromUrl(data: AppData, base: State): State {
  let q: URLSearchParams;
  try { q = new URLSearchParams(location.search); } catch { return base; }
  const s = { ...base };
  const mode = (Object.keys(VIEW_NAMES) as State["mode"][]).find((m) => VIEW_NAMES[m] === q.get("view"));
  if (mode) s.mode = mode;
  const t = Number(q.get("t"));
  if (q.has("t") && Number.isFinite(t)) s.t = clampT(t);
  const zoom = q.get("zoom")?.split("-").map(Number);
  if (zoom?.length === 2 && zoom.every(Number.isFinite)) s.view = clampView([Math.max(...zoom), Math.min(...zoom)]);
  if (s.t > s.view[0] || s.t < s.view[1]) s.view = [...TIME] as Range; // a zoom that doesn't show the time: ignore it
  const family = q.get("family");
  if (family && data.families.some((f) => f.family === family)) {   // only names that exist: a bad link just opens the app
    s.selected = family;
    const genus = q.get("genus");
    if (genus && data.genera[family]?.genera.some((g) => g.genus === genus)) s.genus = genus;
  }
  return s;
}

function toUrl(s: State) {
  const q = new URLSearchParams();
  const atStart = s.mode === "machine" && !s.selected && s.t === INITIAL.t;
  if (!atStart) {
    q.set("view", VIEW_NAMES[s.mode]);
    if (s.selected) q.set("family", s.selected);
    if (s.genus) q.set("genus", s.genus);
    q.set("t", String(round1(s.t)));
    const full = s.view[0] - s.view[1] >= TIME[0] - TIME[1] - 0.01;
    if (!full && s.mode === "timeline") q.set("zoom", `${round1(s.view[0])}-${round1(s.view[1])}`);
  }
  const search = q.toString();
  return `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
}

/** Writes the state into the address, without adding history entries, and at most a few times a second
    (browsers limit replaceState, and playback changes the time every frame). */
function useUrlSync(state: State) {
  useEffect(() => {
    const id = setTimeout(() => {
      const url = toUrl(state);
      if (url !== `${location.pathname}${location.search}${location.hash}`) {
        try { history.replaceState(history.state, "", url); } catch { /* sandboxed: no address to keep */ }
      }
    }, 400);
    return () => clearTimeout(id);
  }, [state]);
}

const Ctx = createContext<{ data: AppData; state: State; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ data, children }: { data: AppData; children: ReactNode }) {
  const reducer = useMemo(() => makeReducer(data), [data]);
  const [state, dispatch] = useReducer(reducer, data, (d) => fromUrl(d, INITIAL));
  useUrlSync(state);
  const value = useMemo(() => ({ data, state, dispatch }), [data, state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}
