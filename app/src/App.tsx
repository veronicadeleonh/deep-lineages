import { useEffect, useState } from "react";
import { FamilyPanel } from "./components/FamilyPanel";
import { PaleoMap } from "./components/PaleoMap";
import { TimelineCard } from "./components/Timeline";
import { TooltipProvider } from "./components/Tooltip";
import { loadData } from "./data";
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
        <Header />
        <main className={s.layout}>
          <TimelineCard />
          <aside className={s.side}>
            <PaleoMap />
            <FamilyPanel />
          </aside>
        </main>
      </TooltipProvider>
    </StoreProvider>
  );
}

function Header() {
  const { data, state } = useStore();
  const period = data.periods.find((p) => state.t <= p.start && state.t >= p.end);
  return (
    <header className={s.top}>
      <div>
        <p className={s.eyebrow}><b>Deep Lineages</b> · dinosaur families of the Mesozoic</p>
        <h1>{fMa(state.t)} Ma {period && <span className={s.period}>· {period.name}</span>}</h1>
      </div>
      <p className={s.hint}>
        Drag along the timeline · <kbd>←</kbd> <kbd>→</kbd> 1 Myr · <kbd>Shift</kbd> 10 Myr · click a family
      </p>
    </header>
  );
}
