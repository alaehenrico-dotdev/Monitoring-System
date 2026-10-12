import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // vite.config.ts injects this from package.json at build time, so any
  // component rendering the app version (Sidebar's footer) throws a
  // ReferenceError under test unless the same define exists here. Hardcoded
  // rather than read from package.json: tests must not assert on, or break
  // with, the real version number.
  define: { __APP_VERSION__: JSON.stringify("0.0.0-test") },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // The Manual Count page tests render a ~1,700-line page with hundreds of
    // cells; run in parallel with the rest of the suite they can pass 5s
    // (the default) on a busy machine without anything being wrong.
    testTimeout: 20_000,
  },
});
