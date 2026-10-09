/* The welcome screen: what this is, in a few lines, over the continents drifting from Pangaea to the end of the
   Cretaceous. Shown on the first visit (remembered in this browser) and whenever the title is clicked. */
import { geoEqualEarth, geoPath } from "d3";
import { useEffect, useMemo, useState } from "react";
import { loadSnapshot, type Snapshot } from "../data";
import { fNum } from "../format";
import { useStore } from "../state";
import s from "./Welcome.module.css";

const VIEWS = [
  { icon: "▶", name: "Time machine", text: "Watch the story, from the first dinosaurs to the asteroid." },
  { icon: "☰", name: "Timeline", text: "When each family lived, and how they branch." },
  { icon: "✺", name: "Family tree", text: "Who is related to whom, down to the species." },
  { icon: "◎", name: "Field guide", text: "What lived where: pick any place on Earth." },
] as const;

export function Welcome({ onStart, onExplore }: { onStart: () => void; onExplore: () => void }) {
  const { data } = useStore();
  const genera = useMemo(() => Object.values(data.genera).reduce((n, fg) => n + fg.genera.length, 0), [data]);

  // the background: one reconstruction after another, oldest first, crossfading
  const times = useMemo(() => [...data.times].sort((a, b) => b - a), [data.times]);
  const [i, setI] = useState(0);
  const [snaps, setSnaps] = useState<Record<number, Snapshot>>({});
  useEffect(() => {
    for (const t of times) loadSnapshot(t, data.paleo).then((sn) => setSnaps((p) => ({ ...p, [t]: sn })));
  }, [times, data.paleo]);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % times.length), 2600);
    return () => clearInterval(id);
  }, [times.length]);
  const W = 1600, H = 820;
  const path = useMemo(() => geoPath(geoEqualEarth().fitExtent([[0, 0], [W, H]], { type: "Sphere" })), []);
  const shapes = useMemo(() => {
    const out: Record<number, string> = {};
    for (const [t, sn] of Object.entries(snaps)) if (sn.coast) out[+t] = sn.coast.features.map((f) => path(f) ?? "").join(" ");
    return out;
  }, [snaps, path]);
  const t = times[i];

  // Esc or Enter: straight in
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExplore(); else if (e.key === "Enter") onStart(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStart, onExplore]);

  return (
    <div className={s.welcome} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <svg className={s.bg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <path className={s.sphere} d={path({ type: "Sphere" }) ?? ""} />
        {times.map((x) => shapes[x] && <path key={x} className={s.land} d={shapes[x]} style={{ opacity: x === t ? 1 : 0 }} />)}
      </svg>
      <span className={s.clock} aria-hidden>{t} million years ago</span>

      <div className={s.content}>
        <p className={s.eyebrow}>🦕 Deep Lineages</p>
        <h1 id="welcome-title">186 million years of dinosaurs</h1>
        <p className={s.lede}>
          Travel from the first dinosaurs to the asteroid, on maps of the world as it was. Every dot is a real fossil,
          placed where it lay when the animal was alive.
        </p>
        <p className={s.stats}>
          <span><b>{fNum(data.families.length)}</b> families</span>
          <span><b>{fNum(genera)}</b> genera</span>
          <span><b>{fNum(data.fossils.length)}</b> fossils</span>
        </p>

        <div className={s.actions}>
          <button className={s.explore} onClick={onExplore}>Explore on my own</button>
          <button className={s.start} onClick={onStart} autoFocus>Start the journey</button>
        </div>

        <ul className={s.views}>
          {VIEWS.map((v) => (
            <li key={v.name}><span className={s.icon} aria-hidden>{v.icon}</span><b>{v.name}</b><span>{v.text}</span></li>
          ))}
        </ul>

        <p className={s.credits}>
          Inspired by Steve Brusatte’s <strong><i>The Rise and Fall of the Dinosaurs</i></strong>.<br />
          <strong>Data:</strong> <a href="https://paleobiodb.org" target="_blank" rel="noopener">Paleobiology Database</a> ·
          <a href="https://gwsdoc.gplates.org" target="_blank" rel="noopener"> PALEOMAP (C. R. Scotese)</a> via GPlates ·
          silhouettes from <a href="https://www.phylopic.org" target="_blank" rel="noopener">PhyloPic</a> ·
          texts from <a href="https://www.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>.
        </p>
      </div>
    </div>
  );
}

/** The welcome again, compact: a dialog over the app, opened from the title. */
export function About({ onClose, onReplay }: { onClose: () => void; onReplay: () => void }) {
  const { data } = useStore();
  const genera = useMemo(() => Object.values(data.genera).reduce((n, fg) => n + fg.genera.length, 0), [data]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className={s.aboutBackdrop} onClick={onClose}>
      <div className={s.about} role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <button className={s.aboutClose} onClick={onClose} aria-label="Close">✕</button>
        <h2 id="about-title" className={s.aboutTitle}>🦕 Deep Lineages</h2>
        <p className={s.aboutCaption}>Dinosaur families of the Mesozoic</p>
        <p className={s.aboutLede}>
          186 million years of dinosaurs, from the first ones to the asteroid, on maps of the world as it was. Every dot
          is a real fossil, placed where it lay when the animal was alive.
        </p>
        <p className={s.stats}>
          <span><b>{fNum(data.families.length)}</b> families</span>
          <span><b>{fNum(genera)}</b> genera</span>
          <span><b>{fNum(data.fossils.length)}</b> fossils</span>
        </p>
        <ul className={`${s.views} ${s.aboutViews}`}>
          {VIEWS.map((v) => (
            <li key={v.name}><span className={s.icon} aria-hidden>{v.icon}</span><b>{v.name}</b><span>{v.text}</span></li>
          ))}
        </ul>
        <p className={s.credits}>
          Inspired by Steve Brusatte’s <strong><i>The Rise and Fall of the Dinosaurs</i></strong>.<br />
          <strong>Data:</strong> <a href="https://paleobiodb.org" target="_blank" rel="noopener">Paleobiology Database</a> ·
          <a href="https://gwsdoc.gplates.org" target="_blank" rel="noopener"> PALEOMAP (C. R. Scotese)</a> via GPlates ·
          silhouettes from <a href="https://www.phylopic.org" target="_blank" rel="noopener">PhyloPic</a> ·
          texts from <a href="https://www.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>.
        </p>
        <div className={s.aboutActions}>
          <button className={s.start} onClick={onReplay} autoFocus>Start the journey</button>
          <button className={s.explore} onClick={onClose}>Explore on my own</button>
        </div>
      </div>
    </div>
  );
}
