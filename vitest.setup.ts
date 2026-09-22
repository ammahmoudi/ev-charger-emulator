import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Only the jsdom project (see vitest.config.ts) loads this file — unmounts each test's render so
// one component test can't leak DOM nodes/event listeners into the next.
afterEach(() => {
  cleanup();
});
