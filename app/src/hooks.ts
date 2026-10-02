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
