import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Without `test.globals: true` in vitest.config.ts (deliberately not set -
// keeping describe/it/expect as explicit imports elsewhere), React Testing
// Library's own automatic per-test cleanup never registers (it relies on a
// global `afterEach`), so a component rendered by one test is still in the
// DOM when the next test's queries run. Registered here once instead of in
// every component test file.
afterEach(() => cleanup());
