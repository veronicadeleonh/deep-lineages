/* A reminder of the keys for a widget you move through with the arrows (a tree, a list): it shows for a moment when
   the widget gets the keyboard focus, goes after a few keys or when you leave, and stays readable for screen readers
   (link it with aria-describedby). Mouse users never see it. */
import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import s from "./KeysHint.module.css";

export function useKeysHint() {
  const [show, setShow] = useState(false);
  const moves = useRef(0);
  useEffect(() => {
    if (!show) return;
    const id = setTimeout(() => setShow(false), 8000);
    return () => clearTimeout(id);
  }, [show]);
  const handlers = {
    // entering the widget (not moving inside it), by keyboard
    onFocus: (e: FocusEvent<Element>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      if ((e.target as Element).matches(":focus-visible")) { moves.current = 0; setShow(true); }
    },
    onBlur: (e: FocusEvent<Element>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShow(false); },
    /** call from the widget's onKeyDown: a few keys and you know them */
    keyed: () => { if (++moves.current >= 4) setShow(false); },
  };
  return { show, handlers };
}

export function KeysHint({ id, show, children }: { id: string; show: boolean; children: ReactNode }) {
  return <p id={id} className={show ? s.hint : "sr-only"}>{children}</p>;
}
