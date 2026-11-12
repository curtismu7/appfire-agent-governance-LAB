import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 7814, npm start) and Vite on VITE_PORT (default 7812). /api is proxied, so the browser only ever talks to one
// origin (same-origin writes). Both ports stay inside 7814-7839 (7814 is the default).
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 7814}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 7812, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", testTimeout: 30000 },
});
