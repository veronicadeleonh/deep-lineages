import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { TIME } from "./constants";
import { isAlive, round1 } from "./format";
import type { AppData, Range } from "./types";

/** Everything the user can change. Time is in Ma (millions of years ago). */
export interface State {
  t: number;                 // cursor position
  selected: string | null;   // selected family
  genus: string | null;      // selected genus (within the selected family)
  expanded: string[];        // families the user unfolded into their genera
  collapsed: string[];       // families the user folded (overrides the automatic unfolding when zoomed in)
  view: Range;               // visible time window [older, younger]
}

export type Action =
  | { type: "time"; t: number }
  | { type: "toggleFamily"; family: string }   // select, or deselect if already selected
  | { type: "fold"; family: string; open: boolean } // unfold/fold without touching the selection
  | { type: "select"; family: string | null }  // select without touching the folds (panel chips)
  | { type: "genus"; family: string; genus: string }
  | { type: "clearGenus" }                     // back from a genus to its family
  | { type: "view"; view: Range };

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

const Ctx = createContext<{ data: AppData; state: State; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ data, children }: { data: AppData; children: ReactNode }) {
  const reducer = useMemo(() => makeReducer(data), [data]);
  const [state, dispatch] = useReducer(reducer, { t: 150, selected: null, genus: null, expanded: [], collapsed: [], view: [...TIME] as Range });
  const value = useMemo(() => ({ data, state, dispatch }), [data, state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}
