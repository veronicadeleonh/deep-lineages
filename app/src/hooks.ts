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
