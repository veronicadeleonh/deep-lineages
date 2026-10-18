import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Width of an element, kept up to date (width changes only: on mobile the browser bar changes the height while scrolling). */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 800) {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver(() => setW((prev) => (el.clientWidth && el.clientWidth !== prev ? el.clientWidth : prev)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
}

/** A ref that always holds the latest value (for event listeners attached once). */
export function useLatest<T>(value: T) {
  const r = useRef(value);
  r.current = value;
  return r;
}

/** Width and height of an element, kept up to date. */
export function useSize(ref: RefObject<HTMLElement | null>, fallback: [number, number] = [800, 500]) {
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((prev) => {
      const w = el.clientWidth || prev[0], h = el.clientHeight || prev[1];
      return w === prev[0] && h === prev[1] ? prev : [w, h];
    });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]); // eslint-disable-line react-hooks/exhaustive-deps
  return size;
}

/** Scrolls the nearest scrolling box so `el` shows, without Element.scrollIntoView: that one also moves the
    browser's Tab starting point to `el`, so after a reload the first Tab skipped everything before it. */
/** The person asked their system to reduce motion: jump instead of animating. */
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** A --dur-* token in ms, as JS animations need it (0 when motion is reduced). */
export const durationOf = (token: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim(); // "260ms", or ".26s" once minified
  const n = parseFloat(v) || 0;
  return v.endsWith("ms") ? n : n * 1000;
};

export function revealInScroller(el: HTMLElement | null, smooth = true) {
  if (!el) return;
  let box = el.parentElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  if (!box) return;
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  const behavior: ScrollBehavior = smooth && !reducedMotion() ? "smooth" : "auto";
  if (r.top < b.top) box.scrollBy({ top: r.top - b.top - 8, behavior });
  else if (r.bottom > b.bottom) box.scrollBy({ top: r.bottom - b.bottom + 8, behavior });
}
