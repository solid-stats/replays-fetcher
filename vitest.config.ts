import { configDefaults, defineConfig } from "vitest/config";

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

export default defineConfig({
  test: {
    coverage: {
      exclude: ["dist/**", "src/**/*.test.ts", "vitest.config.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    exclude,
    include,
  },
});
