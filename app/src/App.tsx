import { useEffect, useState } from "react";
import { FamilyPanel } from "./components/FamilyPanel";
import { TimelineCard } from "./components/Timeline";
import { TreeCard } from "./components/TreeView";
import { FieldGuide } from "./components/FieldGuide";
import { TimeMachine } from "./components/TimeMachine";
import { TooltipProvider } from "./components/Tooltip";
import { PLAY_EVENT } from "./components/TimeMachine";
import { About, Welcome } from "./components/Welcome";
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

/* ---------- the lens: what is selected, and the four ways to look at it ---------- */
const VIEWS = [
  { mode: "machine", icon: "▶", name: "Time machine", ask: "Watch the story" },
  { mode: "timeline", icon: "☰", name: "Timeline", ask: "When did they live?" },
  { mode: "tree", icon: "✺", name: "Family tree", ask: "How are they related?" },
  { mode: "guide", icon: "◎", name: "Field guide", ask: "What lived where?" },
] as const;

/** The selection, followed across views. */
function useFollowed() {
  const { data, state } = useStore();
  const fam = state.selected ? data.families.find((f) => f.family === state.selected) : undefined;
  const g = fam && state.genus ? data.genera[fam.family]?.genera.find((x) => x.genus === state.genus) : undefined;
  return { fam, g };
}

function Following() {
  const { dispatch } = useStore();
  const { fam, g } = useFollowed();
  const sil = g?.phylopic?.svg ?? fam?.phylopic?.svg;
  return (
    <div className={s.following} aria-live="polite">
      {fam ? (
        <>
          <span className={s.followLabel}>Following</span>
          <span className={s.chip}>
            {sil && <i className={s.chipSil} style={{ ["--src" as string]: `url("${silhouetteUrl(sil)}")` }} />}
            {g ? <i>{g.genus}</i> : fam.family}
            <button onClick={() => dispatch({ type: "select", family: null })} aria-label="Stop following" title="Stop following (Esc)">✕</button>
          </span>
          <span className={s.followHint}>in every view</span>
        </>
      ) : <span className={s.followHint}>Pick a dinosaur in any view: it follows you to the others</span>}
    </div>
  );
}

function Views() {
  const { state, dispatch } = useStore();
  const button = (v: (typeof VIEWS)[number]) => (
    <button key={v.mode} role="tab" aria-selected={state.mode === v.mode} onClick={() => dispatch({ type: "mode", mode: v.mode })} title={v.ask}>
      <span className={s.viewIcon} aria-hidden>{v.icon}</span>{v.name}
    </button>
  );
  // the story first; the three deep dives grouped after it
  return (
    <nav className={s.views} role="tablist" aria-label="Views">
      {button(VIEWS[0])}
      <div className={s.dive} role="group" aria-label="Deep dive">
        <span className={s.diveLabel}>Deep dive</span>
        {VIEWS.slice(1).map(button)}
      </div>
    </nav>
  );
}


/** The page. Every view fills the screen exactly except the timeline, which scrolls. */
function Shell() {
  const { state, dispatch } = useStore();
  // the welcome screen: on the first visit in this browser
  const [welcome, setWelcome] = useState(() => { try { return !localStorage.getItem(SEEN); } catch { return true; } });
  const [about, setAbout] = useState(false); // the title opens a compact "about"
  const close = () => { setWelcome(false); try { localStorage.setItem(SEEN, "1"); } catch { /* private mode */ } };
  const start = () => {
    close();
    dispatch({ type: "mode", mode: "machine" });
    dispatch({ type: "time", t: 252 });
    setTimeout(() => window.dispatchEvent(new Event(PLAY_EVENT)), 300); // the time machine starts playing
  };
  return (
    <div className={state.mode !== "timeline" ? s.fullScreen : undefined}>
      <Header onAbout={() => setAbout(true)} />
      <Layout />
      {/* credits, always there and quiet, in the gutter under the views */}
      <footer className={s.footer}>
        By <a href="https://veronicadeleonh.de/" target="_blank" rel="noopener">Verónica De León Hernández</a>
        <span className={s.footSep}>·</span>Data: Paleobiology Database, PALEOMAP (Scotese), PhyloPic, Wikipedia
      </footer>
      {welcome && <Welcome onStart={start} onExplore={close} />}
      {about && <About onClose={() => setAbout(false)} onReplay={() => { setAbout(false); start(); }} />}
    </div>
  );
}

const SEEN = "deep-lineages:welcome-seen";

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

function Header({ onAbout }: { onAbout: () => void }) {
  const { data, state } = useStore();
  const period = data.periods.find((p) => state.t <= p.start && state.t >= p.end);
  // a grid, so the right side lines up with the left: brand / following, time / views, keys / (nothing)
  return (
    <header className={s.top}>
      <p className={s.eyebrow}><button className={s.home} onClick={onAbout} title="About Deep Lineages">🦕 <b>Deep Lineages</b></button><span className={s.tagline}> · dinosaur families of the Mesozoic</span></p>
      <Following />
      <h1>{fMa(state.t)} Ma {period && <span className={s.period}>· {period.name}</span>}</h1>
      <Views />
      {/* the row is always there (empty in the views without keys), so the header keeps its height in every view */}
      <p className={s.hint}>
        {state.mode === "machine" && <><kbd>Space</kbd> plays and pauses · drag the bar to travel · click a family · <kbd>Esc</kbd> closes it</>}
        {state.mode === "tree" && <>Pinch or <kbd>⌘</kbd> + scroll to zoom · drag to move · click a group to center the tree on it · <kbd>Esc</kbd> closes it</>}
        {state.mode === "timeline" && <>Drag along the timeline · <kbd>←</kbd> <kbd>→</kbd> 1 Myr · <kbd>Shift</kbd> 10 Myr · click a family · <kbd>Esc</kbd> closes it</>}
      </p>
    </header>
  );
}
