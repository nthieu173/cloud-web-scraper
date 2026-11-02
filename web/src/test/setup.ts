import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // The Worker's tests run in Node, which has no window.
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});
