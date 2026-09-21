import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

/**
 * One flat config for the whole monorepo (server + client both live here,
 * not two separate configs) - server and client differ only in which
 * globals/plugins apply, via the `files` glob on each block below, so a
 * shared rule change never has to be made in two places.
 *
 * Non-type-checked rules only (`tseslint.configs.recommended`, not
 * `recommendedTypeChecked`) - a deliberate first pass: type-aware linting
 * needs each block wired to its own tsconfig's `project`/`tsconfigRootDir`
 * and meaningfully slows down `eslint .`, so it's left as a follow-up
 * rather than bundled into standing this up from nothing.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.vite/**",
      "**/prisma/migrations/**",
      "**/*.tsbuildinfo",
      "client/vite.config.js",
      "client/vite.config.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // tsconfig.json sets noUnusedLocals/noUnusedParameters: false (so the
      // *compiler* never blocks a build over one) - this still surfaces the
      // same thing as a non-blocking lint warning, since that's real
      // signal worth seeing. `^_` matches this codebase's own existing
      // convention for "intentionally unused" (e.g. errorHandler.ts's
      // `_req`/`_next` - Express's error-handler middleware is recognized
      // by its 4-argument arity, so `_next` has to stay even though it's
      // never read).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // `warn`/`error` still allowed unprefixed - those are legitimate
      // logging, not leftover debugging output. A bare console.log is what
      // this actually catches.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["server/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // `allowConstantExport: true` - several files here export a component
      // alongside a small constant/type (e.g. Spinner.tsx exporting
      // `Spinner`/`LoadingBlock`/`InlineLoading` together), which is normal
      // in this codebase's style, not a Fast Refresh hazard worth flagging.
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Flags the (very common, pre-existing throughout this codebase)
      // "setX(null); fetch().then(setX)" reset-then-load pattern used by
      // nearly every data-fetching page (TotalStocksPage, ManualCountPage,
      // DashboardPage, ...). It's not wrong for what these pages actually
      // need (clear stale data before a new fetch starts) - the "correct"
      // fix the rule wants is a real, deliberate redesign of each page's
      // effect (a key-based remount, or deriving the reset from a computed
      // value instead of an imperative setState) across every one of them,
      // which is a much larger, riskier change than standing up the linter
      // itself should silently trigger. Kept visible as a warning rather
      // than silenced outright.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["**/*.config.{js,mjs,ts}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
