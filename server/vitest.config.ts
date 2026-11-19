import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // The gate covers the code that decides what a stock number IS: the formulas, the daily
      // Online/Offline entries, carry-forward and manual counts, the totals, the day lock and
      // month close, and the reconciliation check. Wiring (routes, scheduler, push delivery) is
      // left out on purpose: it is mostly I/O and would only dilute the figure.
      include: [
        "src/utils/stockMath.ts",
        "src/services/dailyOnlineStock.service.ts",
        "src/services/dailyOfflineStock.service.ts",
        "src/services/totalStocks.service.ts",
        "src/services/manualCounts.service.ts",
        "src/services/stockFlow.service.ts",
        "src/services/daysOfStock.service.ts",
        "src/services/dayLock.service.ts",
        "src/services/monthClose.service.ts",
        "src/services/reconcile.service.ts",
      ],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary", "text"],
      // A little under where it stands today, so a normal change passes and a change that adds
      // calculation code without tests does not. Raise these as the tests improve; never lower
      // them to make a build pass.
      thresholds: { statements: 84, branches: 75, functions: 84, lines: 87 },
    },
  },
});
