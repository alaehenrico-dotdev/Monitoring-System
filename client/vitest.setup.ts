import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom (the test environment) doesn't implement ResizeObserver at all - any
// component that uses one (e.g. RowGlowScroll, ZoomControl) throws
// `ReferenceError: ResizeObserver is not defined` as soon as it mounts under
// test. Tests here only need rendering/layout-adjacent code to not crash,
// never the actual resize callback firing, so a no-op stub is enough.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Without `test.globals: true` in vitest.config.ts (deliberately not set -
// keeping describe/it/expect as explicit imports elsewhere), React Testing
// Library's own automatic per-test cleanup never registers (it relies on a
// global `afterEach`), so a component rendered by one test is still in the
// DOM when the next test's queries run. Registered here once instead of in
// every component test file.
afterEach(() => cleanup());
