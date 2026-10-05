/* The time machine: the paleomap as the main stage, a play button that travels from 252 to 66 Ma, and a short story
   at each turning point. Continents drift between snapshots, fossils pop up, and the families on record at each
   moment wait to be opened. The timeline below works like a video's progress bar. */
import { area, max, scaleLinear } from "d3";
import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { TIME, dietOf } from "../constants";
import { silhouetteUrl } from "../data";
import { fMa, fNum } from "../format";
import { useLatest, useSize, useWidth } from "../hooks";
import { useStore } from "../state";
import { CHAPTERS, chapterAt } from "../story";
import { MachineCard } from "./MachineCard";
import { FOSSIL_WINDOW, MachineMap } from "./MachineMap";
import s from "./TimeMachine.module.css";

/** Fired (on window) to start playing, e.g. from the welcome screen. */
export const PLAY_EVENT = "deep-lineages:play";

const SPEEDS = [1, 2, 4];
const ABOUT = "Press play (or the space bar) to travel from the first dinosaurs to the asteroid; drag the bar to go anywhere. "
  + "Continents: present-day coastlines moved to their past position (PALEOMAP, every 10 million years, crossfading from one to the next); "
  + "each dot is a fossil, brightest at its own age. Click a dot or a family to open it.";
const MYR_PER_SEC = 6;      // at 1×: the whole Mesozoic in about half a minute
const PAUSE_MS = 4200;      // a stop at each chapter, time to read it
const AROUND_MAX = 8;       // families listed in the map's corner (fewer if the screen is short)

export function TimeMachine() {
  const { data, state, dispatch } = useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const [W, stageH] = useSize(wrap, [1000, 600]);
  const [showAll, setShowAll] = useState(false);
  const [about, setAbout] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const t = state.t;
  const latest = useLatest({ t, speed });

  /* ---------- playback ---------- */
  const hold = useRef(0); // until when we stay on a chapter
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (now >= hold.current) {
        const { t, speed } = latest.current;
        let next = t - (dt / 1000) * MYR_PER_SEC * speed;
        // stop at a chapter the step would jump over
        const ch = CHAPTERS.find((c) => c.t < t - 1e-6 && c.t >= next);
        if (ch) { next = ch.t; hold.current = now + PAUSE_MS / Math.sqrt(speed); }
        if (next <= TIME[1]) { next = TIME[1]; setPlaying(false); }
        dispatch({ type: "time", t: next });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, dispatch, latest]);
  // cinema mode: while playing, everything but the map, the clock and the story steps back
  useEffect(() => {
    document.body.classList.toggle("cinema", playing);
    return () => document.body.classList.remove("cinema");
  }, [playing]);

  const play = () => {
    if (!playing && t <= TIME[1] + 0.05) dispatch({ type: "time", t: TIME[0] }); // from the start again
    hold.current = 0;
    setPlaying(!playing);
  };
  // the welcome screen's "Start the journey"
  useEffect(() => {
    const onPlay = () => { hold.current = 0; setPlaying(true); };
    window.addEventListener(PLAY_EVENT, onPlay);
    return () => window.removeEventListener(PLAY_EVENT, onPlay);
  }, []);
  // space bar plays and pauses
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); play(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------- the map: fills the stage, which fills the screen; on a phone it keeps its own shape ---------- */
  const narrow = W <= 700;
  const mapW = W, mapH = narrow ? Math.round(W * 0.55) : stageH;

  /* ---------- who is around: families with fossils near this moment ---------- */
  const tKey = Math.round(t);   // recount once per million years, not every frame
  const near = useMemo(() => data.fossils.filter((f) => Math.abs(f.mid - tKey) < FOSSIL_WINDOW), [data.fossils, tKey]);
  const around = useMemo(() => {
    const n = new Map<string, number>();
    for (const f of near) if (f.family) n.set(f.family, (n.get(f.family) ?? 0) + 1);
    return data.families.filter((f) => n.has(f.family)).map((f) => ({ f, n: n.get(f.family)! })).sort((a, b) => b.n - a.n);
  }, [data, near]);
  const nFossils = near.length;
  // as many families as fit in the right column, with room for the card (the card loses its blurb on short screens)
  const compact = stageH < 600;
  const room = stageH - 32 - 20 - (state.selected ? (compact ? 175 : 310) : 0) - 56;
  const aroundMax = narrow ? AROUND_MAX : Math.max(0, Math.min(AROUND_MAX, Math.floor(room / 27)));
  const shown = showAll ? around : around.slice(0, aroundMax);
  const selAround = around.find((x) => x.f.family === state.selected);
  if (selAround && !shown.includes(selAround)) shown.push(selAround);
  const hidden = around.length - shown.length;
  // chosen in another view, with no fossils right now: it still gets its row (with no count) and its card
  const selFam = state.selected != null && !selAround ? data.families.find((x) => x.family === state.selected) : undefined;
  if (selFam) shown.unshift({ f: selFam, n: 0 });
  const genera = data.diversity.find((d) => d.ma === Math.round(t))?.genera ?? 0;

  const chapter = chapterAt(t);
  // the chapter's most-found animal: the genus with the most fossils between this chapter and the next
  const star = useMemo(() => {
    const i = CHAPTERS.indexOf(chapter);
    const lo = CHAPTERS[i + 1]?.t ?? TIME[1], hi = i + 1 < CHAPTERS.length ? chapter.t : TIME[1] + FOSSIL_WINDOW;
    const n = new Map<string, number>();
    for (const f of data.fossils) if (f.mid <= hi && f.mid >= lo) n.set(f.genus, (n.get(f.genus) ?? 0) + 1);
    for (const [genus, count] of [...n].sort((a, b) => b[1] - a[1])) {
      for (const [family, fg] of Object.entries(data.genera)) {
        const g = fg.genera.find((x) => x.genus === genus);
        if (g) return { genus, family, count, lo, hi, svg: g.phylopic?.svg ?? data.families.find((f) => f.family === family)?.phylopic?.svg ?? null };
      }
    }
    return null;
  }, [chapter, data]);
  const period = data.periods.find((p) => t <= p.start && t >= p.end);

  return (
    <section className={`card ${s.card}`} aria-label="Time machine">
      <div ref={wrap} className={s.stage}>
        <MachineMap W={mapW} H={mapH} />

        {/* the left column, over the ocean: the clock and the story, told in big letters like a film's narration */}
        <div className={s.left}>
          <div className={s.clock}>
            <span className={s.ma}>{fMa(Math.round(t * 10) / 10)}</span><span className={s.unit}>million years ago</span>
            {period && <span className={s.period}>{period.name}</span>}
          </div>
          <div key={chapter.t} className={s.story}>
            <p className={s.storyWhen}>Chapter {CHAPTERS.indexOf(chapter) + 1} of {CHAPTERS.length} · {fMa(chapter.t)} Ma</p>
            <h2>{chapter.title}</h2>
            <p className={s.storyText}>{chapter.text}</p>
            {star && (
              <button className={s.starring} title={`The genus with the most fossils from ${fMa(star.hi)} to ${fMa(star.lo)} Ma`} onClick={() => dispatch({ type: "genus", family: star.family, genus: star.genus })}>
                Most fossils
                {star.svg && <span className={s.starSil} aria-hidden style={{ ["--src" as string]: `url("${silhouetteUrl(star.svg)}")` }} />}
                <i>{star.genus}</i><span className={s.starN}>· {fNum(star.count)}</span>
              </button>
            )}
          </div>
          {(narrow || stageH >= 430) && <ChapterChart t={t} />}
        </div>

        {/* the right column: who is around right now, and the selected animal's card */}
        <div className={s.right} data-cinema="dim">
          <span className={s.counter}><b>{fNum(genera)}</b> genera on record · <b>{fNum(nFossils)}</b> fossils on the map</span>
          <div className={s.around}>
            <span className={s.aroundLabel}>On the map now</span>
            {around.length === 0 && <span className={s.aroundNone}>No fossils of these families in this slice of time</span>}
            {/* the selected family stays in the list (even past the limit) and its card unfolds right below it */}
            {shown.map(({ f, n }) => (
              <Fragment key={f.family}>
                <button className={`${s.who} ${state.selected === f.family ? s.whoOn : ""}`} aria-expanded={state.selected === f.family}
                  onClick={() => dispatch({ type: "select", family: state.selected === f.family ? null : f.family })}
                  title={state.selected === f.family ? "Collapse" : `${f.family} · ${n} fossils here`}>
                  <i className="swatch" style={{ background: dietOf(f).color }} />
                  <span>{f.family}</span>
                  {f.phylopic?.svg && <i className={s.whoSil} style={{ ["--src" as string]: `url("${silhouetteUrl(f.phylopic.svg)}")` }} />}
                  {state.selected === f.family && <svg className={s.whoChev} viewBox="0 0 10 6" aria-hidden><path d="M1 5l4-4 4 4" /></svg>}
                </button>
                {state.selected === f.family && <MachineCard compact={compact && !narrow} />}
              </Fragment>
            ))}
            {(showAll ? around.length > aroundMax : hidden > 0) && (
              <button className={s.aroundMore} onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
                {showAll ? "Show fewer" : shown.length === 0 ? `Show the ${around.length} families` : `+${hidden} more ${hidden === 1 ? "family" : "families"}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* the controls: play, speed and the scrubber */}
      <div className={s.controls}>
        <button className={s.play} onClick={play} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
        <div className={s.speed} role="group" aria-label="Speed">
          {SPEEDS.map((v) => <button key={v} aria-pressed={speed === v} onClick={() => setSpeed(v)}>{v}×</button>)}
        </div>
        <Scrubber t={t} onScrub={(v) => { setPlaying(false); dispatch({ type: "time", t: v }); }} />
        <button className={s.about} aria-label="About the map" aria-expanded={about} onClick={() => setAbout(!about)}>i</button>
        {about && <p className={s.aboutPop} role="note" onClick={() => setAbout(false)}>{ABOUT}</p>}
      </div>

    </section>
  );
}

/** The progress bar: periods, the number of genera through time, the story's stops, and a draggable cursor. */
function Scrubber({ t, onScrub }: { t: number; onScrub: (t: number) => void }) {
  const { data } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const W = useWidth(ref, 800);
  const H = 64;
  const x = scaleLinear().domain(TIME).range([8, W - 8]);
  const y = scaleLinear().domain([0, max(data.diversity, (d) => d.genera) ?? 1]).range([H - 18, 18]);
  const d = area<{ ma: number; genera: number }>().x((p) => x(p.ma)).y0(H - 18).y1((p) => y(p.genera))(data.diversity) ?? "";
  const toT = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(TIME[1], Math.min(TIME[0], x.invert(clientX - r.left)));
  };
  const drag = useRef(false);
  const down = (e: PointerEvent<HTMLDivElement>) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); onScrub(toT(e.clientX)); };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (drag.current) onScrub(toT(e.clientX)); };
  const up = () => { drag.current = false; };
  return (
    <div ref={ref} className={s.scrubber} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      role="slider" aria-label="Time" aria-valuemin={TIME[1]} aria-valuemax={TIME[0]} aria-valuenow={t}>
      <svg width={W} height={H}>
        {data.periods.map((p, i) => (
          <g key={p.name}>
            <rect className={i % 2 ? s.bandAlt : s.band} x={x(p.start)} width={x(p.end) - x(p.start)} y={0} height={H - 14} />
            {x(p.end) - x(p.start) > p.name.length * 6.4 + 10 && <text className={s.bandLabel} x={(x(p.start) + x(p.end)) / 2} y={11} textAnchor="middle">{p.name}</text>}
          </g>
        ))}
        <path className={s.area} d={d} />
        {CHAPTERS.map((c) => (
          <g key={c.t} className={s.stop} onPointerDown={(e) => { e.stopPropagation(); onScrub(c.t); }}>
            <circle cx={x(c.t)} cy={H - 18} r={t <= c.t + 1e-6 ? 5 : 4} className={t <= c.t + 1e-6 ? s.stopPassed : undefined} />
            <title>{`${fMa(c.t)} Ma · ${c.title}`}</title>
          </g>
        ))}
        <line className={s.cursor} x1={x(t)} x2={x(t)} y1={0} y2={H - 10} />
        <circle className={s.handle} cx={x(t)} cy={H - 18} r={7} />
        {[250, 200, 150, 100].map((v) => <text key={v} className={s.tick} x={x(v)} y={H - 1} textAnchor="middle">{v} Ma</text>)}
      </svg>
    </div>
  );
}

/** The story's chart: dinosaur genera on record through the whole Mesozoic, drawn as far as the journey has gone,
    with the current chapter's stretch lit up. */
function ChapterChart({ t }: { t: number }) {
  const { data } = useStore();
  const W = 300, H = 64, pad = 4;
  const x = scaleLinear().domain(TIME).range([pad, W - pad]);
  const y = scaleLinear().domain([0, max(data.diversity, (d) => d.genera) ?? 1]).range([H - 14, 6]);
  const mk = (pts: { ma: number; genera: number }[]) => area<{ ma: number; genera: number }>().x((p) => x(p.ma)).y0(H - 14).y1((p) => y(p.genera))(pts) ?? "";
  const ch = chapterAt(t), i = CHAPTERS.indexOf(ch), end = CHAPTERS[i + 1]?.t ?? TIME[1];
  const past = data.diversity.filter((d) => d.ma >= t);
  const now = data.diversity.find((d) => d.ma === Math.round(t))?.genera ?? 0;
  return (
    <figure className={s.chart}>
      <figcaption><b>{fNum(now)}</b> dinosaur genera on record now</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Dinosaur genera on record through time">
        <rect className={s.chartBand} x={x(ch.t)} width={Math.max(2, x(end) - x(ch.t))} y={0} height={H - 14} />
        <path className={s.chartAll} d={mk(data.diversity)} />
        <path className={s.chartPast} d={mk(past)} />
        <line className={s.chartBase} x1={pad} x2={W - pad} y1={H - 14} y2={H - 14} />
        <circle className={s.chartDot} cx={x(t)} cy={y(now)} r={3.5} />
        <text className={s.chartTick} x={pad} y={H - 2}>252 Ma</text>
        <text className={s.chartTick} x={W - pad} y={H - 2} textAnchor="end">66 Ma</text>
      </svg>
    </figure>
  );
}
