/// <reference types="vite/client" />
// jest-dom's matchers (toBeInTheDocument, toBeDisabled, ...) augment
// Vitest's own Assertion interface, but only wherever this module is
// actually imported - vitest.setup.ts imports it for the *test runtime*,
// but that file sits outside tsconfig.json's `include: ["src"]`, so a plain
// `tsc --noEmit` never picks up its augmentation. Referenced here (inside
// src) so every component test's `expect(...).toBeInTheDocument()` etc.
// type-checks too, not just runs.
/// <reference types="@testing-library/jest-dom" />
