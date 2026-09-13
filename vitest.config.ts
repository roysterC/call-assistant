import { defineConfig } from "vitest/config";
import path from "path";

// Narrow on purpose: only the pure booking/hours logic is unit-tested. Slot
// arithmetic across DST boundaries, service durations and patch-test windows
// is the code where a silent bug books a client wrongly; everything else in
// this app is verified by exercising it.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
