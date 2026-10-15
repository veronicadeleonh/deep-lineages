import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App";
import { Tokens } from "./components/Tokens";
import "./global.css";

// the token lab: a floating panel to try token values live, only while developing
const TokenLab = import.meta.env.DEV ? lazy(() => import("./components/TokenLab").then((m) => ({ default: m.TokenLab }))) : null;

/** /#tokens shows the design tokens page; anything else, the app. */
function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return (
    <>
      {hash === "#tokens" ? <Tokens /> : <App />}
      {TokenLab && <Suspense fallback={null}><TokenLab /></Suspense>}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
    <Analytics />
  </StrictMode>,
);
