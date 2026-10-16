import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The processed data (data/processed/) is served as static files at the app root,
// so the app and the Python pipeline share one copy of the data.
export default defineConfig({
  plugins: [react()],
  publicDir: "../data/processed",
  base: "/", // absolute paths: the app answers at /timeline/Tyrannosauridae too (vercel.json sends every path to index.html)
});
