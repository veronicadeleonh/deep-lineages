import { useEffect, useState } from "react";
import { FamilyPanel } from "./components/FamilyPanel";
import { TimelineCard } from "./components/Timeline";
import { TreeCard } from "./components/TreeView";
import { FieldGuide } from "./components/FieldGuide";
import { TimeMachine } from "./components/TimeMachine";
import { TooltipProvider } from "./components/Tooltip";
import { loadData, silhouetteUrl } from "./data";
import { fMa } from "./format";
import { StoreProvider, useStore } from "./state";
import type { AppData } from "./types";
import s from "./App.module.css";

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadData().then(setData, (e: Error) => setError(e.message)); }, []);

  if (error) return (
    <main className={s.layout}>
      <section className="card">
        <h2>Could not load the data</h2>
        <p>{error}</p>
        <p className="note">Run the scripts in <code>scripts/</code> first (see README), then <code>npm run dev</code> inside <code>app/</code>.</p>
      </section>
    </main>
  );
  if (!data) return <p className={s.loading}>Loading…</p>;

  return (
    <StoreProvider data={data}>
      <TooltipProvider>
        <Shell />
      </TooltipProvider>
    </StoreProvider>
  );
}

/** The page. Every view fills the screen exactly except the timeline, which scrolls. */
function Shell() {
  const { state } = useStore();
  return (
    <div className={state.mode !== "timeline" ? s.fullScreen : undefined}>
      <Header />
      <Layout />
    </div>
  );
}

/** Full-width timeline; the profile opens as a column on the right (a bottom sheet on phones) when something is selected. */
function Layout() {
  const { data, state, dispatch } = useStore();
  const selected = state.selected != null;
  const open = selected && state.mode !== "machine"; // the time machine shows its own small card instead
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dispatch({ type: "select", family: null }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, dispatch]);
  // the profile can be folded to a thin rail (to give the view room) and unfolded again; a new selection unfolds it
  const [folded, setFolded] = useState(false);
  useEffect(() => setFolded(false), [state.selected, state.genus]);
  const fam = state.selected ? data.families.find((f) => f.family === state.selected) : undefined;
  const sil = (state.genus && data.genera[state.selected ?? ""]?.genera.find((g) => g.genus === state.genus)?.phylopic?.svg) || fam?.phylopic?.svg;
  return (
    <main className={`${s.layout} ${open ? (folded ? s.withRail : s.withPanel) : ""}`}>
      {state.mode === "machine" ? <TimeMachine /> : state.mode === "tree" ? <TreeCard /> : state.mode === "guide" ? <FieldGuide /> : <TimelineCard />}
      {open && folded && (
        <div className={s.rail}>
          <button className={s.railOpen} onClick={() => setFolded(false)} aria-label="Show the profile" title="Show the profile">
            <span className={s.railChev}>‹</span>
            {sil && <i className={s.railSil} style={{ ["--src" as string]: `url("${silhouetteUrl(sil)}")` }} />}
            <span className={s.railName}>{state.genus ? <i>{state.genus}</i> : state.selected}</span>
          </button>
          <button className={s.railClose} onClick={() => dispatch({ type: "select", family: null })} aria-label="Clear the selection" title="Clear the selection">✕</button>
        </div>
      )}
      {open && !folded && (
        <div className={s.panelCol}>
          <button className={s.fold} onClick={() => setFolded(true)} aria-label="Hide the profile" title="Hide the profile">›</button>
          <aside className={s.panel}><FamilyPanel /></aside>
        </div>
      )}
    </main>
  );
}

function Header() {
  const { data, state, dispatch } = useStore();
  const period = data.periods.find((p) => state.t <= p.start && state.t >= p.end);
  return (
    <header className={s.top} data-cinema="dim">
      <div>
        <p className={s.eyebrow}><b>Deep Lineages</b> · dinosaur families of the Mesozoic</p>
        <h1>{fMa(state.t)} Ma {period && <span className={s.period}>· {period.name}</span>}</h1>
      </div>
      <div className={s.views} role="tablist" aria-label="View">
        {(["machine", "timeline", "tree", "guide"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={state.mode === m} onClick={() => dispatch({ type: "mode", mode: m })}>
            {m === "machine" ? "Time machine" : m === "timeline" ? "Timeline" : m === "tree" ? "Family tree" : "Field guide"}
          </button>
        ))}
      </div>
      <p className={s.hint}>
        {state.mode === "machine"
          ? <><kbd>Space</kbd> plays and pauses · drag the bar to travel · click a family · <kbd>Esc</kbd> closes it</>
          : <>Drag along the timeline · <kbd>←</kbd> <kbd>→</kbd> 1 Myr · <kbd>Shift</kbd> 10 Myr · click a family · <kbd>Esc</kbd> closes it</>}
      </p>
    </header>
  );
}
