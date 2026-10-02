import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import s from "./Tooltip.module.css";

type Show = (content: ReactNode, ev: { clientX: number; clientY: number }) => void;
const Ctx = createContext<{ show: Show; hide: () => void }>({ show: () => {}, hide: () => {} });

/** One floating tooltip for the whole app. Its state lives here, so showing it does not re-render the app. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ content: ReactNode; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const show = useCallback<Show>((content, ev) => setTip({ content, x: ev.clientX, y: ev.clientY }), []);
  const hide = useCallback(() => setTip(null), []);
  const api = useRef({ show, hide }).current;

  // keep it inside the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    el.style.left = `${Math.min(tip.x + 14, window.innerWidth - el.offsetWidth - 8)}px`;
    el.style.top = `${tip.y + 14}px`;
  }, [tip]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {tip && <div ref={ref} className={s.tooltip} role="tooltip">{tip.content}</div>}
    </Ctx.Provider>
  );
}

export const useTooltip = () => useContext(Ctx);
