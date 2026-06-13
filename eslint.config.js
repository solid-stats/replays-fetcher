import js from "@eslint/js";
import importPlugin from "eslint-plugin-import-x";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.all,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "import-x": importPlugin,
      unicorn,
    },
    rules: {
      ...importPlugin.configs.recommended.rules,
      ...importPlugin.configs.typescript.rules,
      ...unicorn.configs.recommended.rules,
      "import-x/order": [
        "error",
        {
          alphabetize: {
            caseInsensitive: true,
            order: "asc",
          },
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
          "newlines-between": "always",
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "off",
      "capitalized-comments": "off",
      "func-style": "off",
      "max-lines-per-function": [
        "error",
        {
          max: 100,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-statements": [
        "error",
        {
          max: 25,
        },
      ],
      "no-magic-numbers": [
        "error",
        {
          ignore: [-2, 0, 1, 2, 4],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
        },
      ],
      "no-undefined": "off",
      "no-use-before-define": [
        "error",
        {
          classes: true,
          functions: false,
          variables: true,
        },
      ],
      "one-var": "off",
      "sort-imports": "off",
      "sort-keys": "off",
      "unicorn/prevent-abbreviations": [
        "error",
        {
          allowList: {
            cli: true,
            env: true,
            s3: true,
          },
        },
      ],
    },
    settings: {
      "import-x/resolver": {
        node: true,
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
  },
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "eslint.config.js",
      ".agents/**",
      ".claude/**",
      ".planning/**",
    ],
  },
);
