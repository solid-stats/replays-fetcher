import { vitestBaseConfig } from "@solid-stats/ts-toolchain/vitest/base";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

if (process.env["VITEST_INTEGRATION"] === "true") {
  process.argv.push("src/**/*.integration.test.ts");
}
const isIntegrationRun = process.argv.some((argument) =>
  argument.includes(".integration.test.ts"),
);
let exclude = [...configDefaults.exclude, "src/**/*.integration.test.ts"];
let include = ["src/**/*.test.ts"];
if (isIntegrationRun) {
  exclude = [...configDefaults.exclude];
  include = ["**/*.integration.test.ts"];
}

// coverage provider (v8) + 100% thresholds are inherited from the shared
// @solid-stats/ts-toolchain vitest preset (CFG-04 single-source-of-truth); only
// the fetcher-local include/exclude and test file globs are overlaid here.
export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {
      coverage: {
        exclude: [
          "dist/**",
          "src/**/*.test.ts",
          // Test-infrastructure files (shared schema DDL helper + golden fixture
          // loader) are exercised only by the coverage-excluded integration
          // suite, never by unit tests — the same legitimate exclusion class as
          // the CLI entrypoint. The `.fixtures` marker also excludes them from
          // depcruise.
          "src/**/*.fixtures.ts",
          "src/run/golden-fixtures.ts",
          "src/cli.ts",
          "vitest.config.ts",
        ],
        include: ["src/**/*.ts"],
      },
      exclude,
      include,
    },
  }),
);
