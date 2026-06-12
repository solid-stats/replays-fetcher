/**
 * Spike 001 — generate a candidate `@solidstats/config` Oxlint preset by porting
 * vocalclub's curated ESLint ruleset (eslint core + typescript + unicorn + import).
 *
 * Strategy for OQ-1b: emit EVERY ported rule (even `off`) so Oxlint's own
 * "unknown rule" diagnostics tell us authoritatively which rules this Oxlint
 * version supports vs. drops. Severity only (no options) — option compatibility
 * is a migration-phase concern; rule *recognition* is what the spike validates.
 *
 * Prefix mapping: vocalclub uses `ts/*` for typescript-eslint; Oxlint uses
 * `typescript/*`. Core ESLint rules carry no prefix. `unicorn/*` and `import/*`
 * are kept verbatim.
 */

const sev = (n) => (n === 2 ? 'error' : n === 1 ? 'warn' : 'off');

// --- eslint core: possibleProblems + suggestions (vocalclub linterRules/eslint) ---
const eslintCore = {
  'array-callback-return': 2, 'for-direction': 2, 'no-async-promise-executor': 2,
  'no-await-in-loop': 2, 'no-compare-neg-zero': 2, 'no-cond-assign': 2,
  'no-constant-binary-expression': 2, 'no-constant-condition': 2, 'no-constructor-return': 2,
  'no-control-regex': 2, 'no-debugger': 2, 'no-dupe-else-if': 2, 'no-duplicate-imports': 0,
  'no-empty-character-class': 2, 'no-empty-pattern': 2, 'no-ex-assign': 2, 'no-fallthrough': 2,
  'no-import-assign': 2, 'no-inner-declarations': 2, 'no-invalid-regexp': 2,
  'no-irregular-whitespace': 2, 'no-loss-of-precision': 2, 'no-misleading-character-class': 2,
  'no-new-native-nonconstructor': 2, 'no-promise-executor-return': 2, 'no-prototype-builtins': 2,
  'no-self-assign': 2, 'no-self-compare': 2, 'no-sparse-arrays': 2, 'no-template-curly-in-string': 2,
  'no-unexpected-multiline': 2, 'no-unmodified-loop-condition': 2, 'no-unreachable': 2,
  'no-unreachable-loop': 2, 'no-unsafe-finally': 2, 'no-unsafe-optional-chaining': 2,
  'no-unused-private-class-members': 2, 'no-use-before-define': 0, 'no-useless-assignment': 2,
  'no-useless-backreference': 2, 'require-atomic-updates': 2, 'use-isnan': 2, 'valid-typeof': 2,
  // suggestions
  'accessor-pairs': 2, 'arrow-body-style': 2, 'block-scoped-var': 2, 'capitalized-comments': 0,
  'class-methods-use-this': 0, 'consistent-return': 0, 'consistent-this': 2, 'curly': 2,
  'default-case': 0, 'default-case-last': 2, 'default-param-last': 0, 'dot-notation': 0,
  'eqeqeq': 2, 'func-name-matching': 2, 'func-names': 2, 'func-style': 2, 'grouped-accessor-pairs': 2,
  'guard-for-in': 2, 'id-length': 2, 'init-declarations': 0, 'logical-assignment-operators': 2,
  'max-classes-per-file': 2, 'max-depth': 2, 'max-lines': 2, 'max-lines-per-function': 0,
  'max-nested-callbacks': 2, 'max-params': 0, 'new-cap': 2, 'no-alert': 2, 'no-array-constructor': 0,
  'no-bitwise': 2, 'no-caller': 2, 'no-case-declarations': 2, 'no-console': 2, 'no-continue': 1,
  'no-delete-var': 2, 'no-div-regex': 2, 'no-else-return': 2, 'no-empty': 2, 'no-empty-function': 0,
  'no-empty-static-block': 2, 'no-eq-null': 2, 'no-eval': 2, 'no-extend-native': 2, 'no-extra-bind': 2,
  'no-extra-boolean-cast': 2, 'no-global-assign': 2, 'no-implicit-coercion': 2, 'no-implicit-globals': 2,
  'no-implied-eval': 0, 'no-iterator': 2, 'no-labels': 2, 'no-lone-blocks': 2, 'no-lonely-if': 2,
  'no-loop-func': 0, 'no-magic-numbers': 0, 'no-multi-assign': 2, 'no-multi-str': 2,
  'no-negated-condition': 2, 'no-new': 2, 'no-new-func': 2, 'no-new-wrappers': 2,
  'no-nonoctal-decimal-escape': 2, 'no-object-constructor': 2, 'no-octal': 2, 'no-octal-escape': 2,
  'no-param-reassign': 1, 'no-plusplus': 2, 'no-proto': 2, 'no-redeclare': 2, 'no-regex-spaces': 2,
  'no-return-assign': 2, 'no-script-url': 2, 'no-sequences': 2, 'no-shadow': 0,
  'no-shadow-restricted-names': 2, 'no-throw-literal': 0, 'no-undef-init': 0, 'no-undefined': 0,
  'no-underscore-dangle': 1, 'no-unneeded-ternary': 2, 'no-unused-expressions': 0, 'no-useless-call': 2,
  'no-useless-catch': 2, 'no-useless-computed-key': 2, 'no-useless-concat': 2, 'no-useless-constructor': 0,
  'no-useless-escape': 2, 'no-useless-rename': 2, 'no-useless-return': 2, 'no-var': 2, 'no-void': 0,
  'no-with': 2, 'object-shorthand': 2, 'operator-assignment': 2, 'prefer-arrow-callback': 2,
  'prefer-const': 2, 'prefer-destructuring': 0, 'prefer-exponentiation-operator': 2,
  'prefer-named-capture-group': 2, 'prefer-numeric-literals': 2, 'prefer-object-has-own': 2,
  'prefer-object-spread': 2, 'prefer-promise-reject-errors': 0, 'prefer-regex-literals': 2,
  'prefer-rest-params': 2, 'prefer-spread': 2, 'radix': 2, 'require-await': 0,
  'require-unicode-regexp': 2, 'require-yield': 2, 'symbol-description': 2, 'yoda': 2,
};

// --- typescript-eslint (vocalclub linterRules/typescript.ts), ts/ -> typescript/ ---
const tsRaw = {
  'adjacent-overload-signatures': 2, 'array-type': 2, 'await-thenable': 2, 'ban-ts-comment': 2,
  'ban-tslint-comment': 2, 'class-methods-use-this': 2, 'consistent-generic-constructors': 2,
  'consistent-indexed-object-style': 2, 'consistent-type-assertions': 2, 'consistent-type-definitions': 2,
  'consistent-type-exports': 2, 'default-param-last': 2, 'dot-notation': 2,
  'explicit-function-return-type': 0, 'explicit-member-accessibility': 2, 'explicit-module-boundary-types': 2,
  'init-declarations': 2, 'max-params': 2, 'member-ordering': 2, 'method-signature-style': 2,
  'naming-convention': 2, 'no-array-constructor': 2, 'no-array-delete': 2, 'no-base-to-string': 2,
  'no-confusing-non-null-assertion': 2, 'no-confusing-void-expression': 2, 'no-deprecated': 2,
  'no-duplicate-enum-values': 2, 'no-duplicate-type-constituents': 2, 'no-empty-function': 2,
  'no-empty-object-type': 2, 'no-explicit-any': 2, 'no-extra-non-null-assertion': 2,
  'no-extraneous-class': 2, 'no-floating-promises': 2, 'no-for-in-array': 2, 'no-implied-eval': 2,
  'no-import-type-side-effects': 2, 'no-inferrable-types': 2, 'no-invalid-void-type': 2,
  'no-loop-func': 2, 'no-magic-numbers': 1, 'no-meaningless-void-operator': 2, 'no-misused-new': 2,
  'no-misused-promises': 2, 'no-misused-spread': 2, 'no-mixed-enums': 2, 'no-namespace': 2,
  'no-non-null-asserted-nullish-coalescing': 2, 'no-non-null-asserted-optional-chain': 2,
  'no-non-null-assertion': 2, 'no-redundant-type-constituents': 2, 'no-require-imports': 2,
  'no-shadow': 2, 'no-this-alias': 2, 'no-unnecessary-boolean-literal-compare': 2,
  'no-unnecessary-condition': 2, 'no-unnecessary-parameter-property-assignment': 2,
  'no-unnecessary-qualifier': 2, 'no-unnecessary-template-expression': 2, 'no-unnecessary-type-arguments': 2,
  'no-unnecessary-type-assertion': 2, 'no-unnecessary-type-constraint': 2, 'no-unnecessary-type-parameters': 1,
  'no-unsafe-argument': 2, 'no-unsafe-assignment': 2, 'no-unsafe-call': 2, 'no-unsafe-declaration-merging': 2,
  'no-unsafe-enum-comparison': 2, 'no-unsafe-function-type': 1, 'no-unsafe-member-access': 2,
  'no-unsafe-return': 2, 'no-unsafe-type-assertion': 0, 'no-unsafe-unary-minus': 2,
  'no-unused-expressions': 2, 'no-unused-vars': 2, 'no-use-before-define': 2, 'no-useless-constructor': 2,
  'no-useless-empty-export': 2, 'no-wrapper-object-types': 2, 'only-throw-error': 2,
  'parameter-properties': 2, 'prefer-as-const': 2, 'prefer-destructuring': 2, 'prefer-enum-initializers': 2,
  'prefer-find': 2, 'prefer-for-of': 2, 'prefer-function-type': 2, 'prefer-includes': 2,
  'prefer-literal-enum-member': 2, 'prefer-namespace-keyword': 2, 'prefer-nullish-coalescing': 1,
  'prefer-optional-chain': 2, 'prefer-promise-reject-errors': 2, 'prefer-readonly-parameter-types': 0,
  'prefer-reduce-type-parameter': 2, 'prefer-regexp-exec': 2, 'prefer-return-this-type': 2,
  'prefer-string-starts-ends-with': 2, 'promise-function-async': 2, 'related-getter-setter-pairs': 2,
  'require-array-sort-compare': 2, 'require-await': 2, 'restrict-plus-operands': 2,
  'restrict-template-expressions': 2, 'return-await': 2, 'strict-boolean-expressions': 2,
  'switch-exhaustiveness-check': 2, 'triple-slash-reference': 2, 'unbound-method': 2,
  'unified-signatures': 2, 'use-unknown-in-catch-callback-variable': 2,
};

// --- unicorn (vocalclub linterRules/unicorn.ts) ---
const unicornRaw = {
  'better-regex': 2, 'catch-error-name': 2, 'consistent-assert': 0, 'consistent-date-clone': 2,
  'consistent-destructuring': 2, 'consistent-empty-array-spread': 2, 'consistent-existence-index-check': 2,
  'consistent-function-scoping': 2, 'custom-error-definition': 2, 'empty-brace-spaces': 2,
  'error-message': 2, 'escape-case': 2, 'expiring-todo-comments': 0, 'explicit-length-check': 2,
  'filename-case': 0, 'import-style': 0, 'new-for-builtins': 2, 'no-abusive-eslint-disable': 2,
  'no-accessor-recursion': 2, 'no-anonymous-default-export': 2, 'no-array-callback-reference': 0,
  'no-array-for-each': 0, 'no-array-method-this-argument': 2, 'no-array-push-push': 2,
  'no-array-reduce': 0, 'no-await-expression-member': 2, 'no-await-in-promise-methods': 2,
  'no-console-spaces': 2, 'no-document-cookie': 2, 'no-empty-file': 2, 'no-for-loop': 2,
  'no-hex-escape': 2, 'no-instanceof-builtins': 2, 'no-invalid-fetch-options': 2,
  'no-invalid-remove-event-listener': 2, 'no-keyword-prefix': 0, 'no-length-as-slice-end': 2,
  'no-lonely-if': 2, 'no-magic-array-flat-depth': 2, 'no-named-default': 2, 'no-negated-condition': 2,
  'no-negation-in-equality-check': 2, 'no-nested-ternary': 2, 'no-new-array': 2, 'no-new-buffer': 2,
  'no-null': 0, 'no-object-as-default-parameter': 2, 'no-process-exit': 2,
  'no-single-promise-in-promise-methods': 2, 'no-static-only-class': 2, 'no-thenable': 2,
  'no-this-assignment': 2, 'no-typeof-undefined': 2, 'no-unnecessary-await': 2,
  'no-unnecessary-polyfills': 2, 'no-unreadable-array-destructuring': 2, 'no-unreadable-iife': 2,
  'no-unused-properties': 2, 'no-useless-fallback-in-spread': 2, 'no-useless-length-check': 2,
  'no-useless-promise-resolve-reject': 2, 'no-useless-spread': 2, 'no-useless-switch-case': 0,
  'no-useless-undefined': 2, 'no-zero-fractions': 2, 'number-literal-case': 2,
  'numeric-separators-style': 2, 'prefer-add-event-listener': 2, 'prefer-array-find': 2,
  'prefer-array-flat': 2, 'prefer-array-flat-map': 2, 'prefer-array-index-of': 2, 'prefer-array-some': 2,
  'prefer-at': 2, 'prefer-blob-reading-methods': 2, 'prefer-code-point': 2, 'prefer-date-now': 2,
  'prefer-default-parameters': 2, 'prefer-dom-node-append': 2, 'prefer-dom-node-dataset': 2,
  'prefer-dom-node-remove': 2, 'prefer-dom-node-text-content': 2, 'prefer-event-target': 2,
  'prefer-export-from': 2, 'prefer-global-this': 2, 'prefer-includes': 2, 'prefer-json-parse-buffer': 2,
  'prefer-keyboard-event-key': 2, 'prefer-logical-operator-over-ternary': 2, 'prefer-math-min-max': 2,
  'prefer-math-trunc': 2, 'prefer-modern-dom-apis': 2, 'prefer-modern-math-apis': 2, 'prefer-module': 2,
  'prefer-native-coercion-functions': 2, 'prefer-negative-index': 2, 'prefer-node-protocol': 2,
  'prefer-number-properties': 2, 'prefer-object-from-entries': 2, 'prefer-optional-catch-binding': 2,
  'prefer-prototype-methods': 2, 'prefer-query-selector': 2, 'prefer-reflect-apply': 2,
  'prefer-regexp-test': 2, 'prefer-set-has': 2, 'prefer-set-size': 2, 'prefer-spread': 1,
  'prefer-string-raw': 2, 'prefer-string-replace-all': 2, 'prefer-string-slice': 2,
  'prefer-string-starts-ends-with': 2, 'prefer-string-trim-start-end': 2, 'prefer-structured-clone': 2,
  'prefer-switch': 2, 'prefer-ternary': 2, 'prefer-top-level-await': 2, 'prefer-type-error': 2,
  'prevent-abbreviations': 2, 'relative-url-style': 2, 'require-array-join-separator': 2,
  'require-number-to-fixed-digits-argument': 2, 'require-post-message-target-origin': 2,
  'string-content': 2, 'switch-case-braces': 2, 'template-indent': 2, 'text-encoding-identifier-case': 2,
  'throw-new-error': 2,
};

// --- import (vocalclub linterRules/import/*) ---
const importRaw = {
  'export': 2, 'no-deprecated': 2, 'no-empty-named-blocks': 2, 'no-extraneous-dependencies': 2,
  'no-mutable-exports': 2, 'no-named-as-default': 0, 'no-named-as-default-member': 0,
  'no-unused-modules': 2, 'no-amd': 2, 'no-commonjs': 2, 'no-import-module-exports': 2,
  'no-nodejs-modules': 0, 'default': 2, 'no-absolute-path': 2, 'no-cycle': 2,
  'no-relative-packages': 2, 'no-self-import': 2, 'no-unresolved': 2, 'no-useless-path-segments': 2,
  'consistent-type-specifier-style': 2, 'exports-last': 0, 'extensions': 2, 'first': 2,
  'group-exports': 0, 'newline-after-import': 2, 'no-anonymous-default-export': 2,
  'no-duplicates': 2, 'no-namespace': 0, 'no-unassigned-import': 2, 'order': 2,
};

const rules = {};
for (const [k, v] of Object.entries(eslintCore)) rules[k] = sev(v);
for (const [k, v] of Object.entries(tsRaw)) rules[`typescript/${k}`] = sev(v);
for (const [k, v] of Object.entries(unicornRaw)) rules[`unicorn/${k}`] = sev(v);
for (const [k, v] of Object.entries(importRaw)) rules[`import/${k}`] = sev(v);

const config = {
  $schema: './node_modules/oxlint/configuration_schema.json',
  plugins: ['typescript', 'unicorn', 'import', 'oxc'],
  rules,
};

const fs = await import('node:fs');
const url = await import('node:url');
const dir = url.fileURLToPath(new URL('.', import.meta.url));
fs.writeFileSync(`${dir}/oxlintrc.candidate.json`, JSON.stringify(config, null, 2) + '\n');

const counts = {
  eslint: Object.keys(eslintCore).length,
  typescript: Object.keys(tsRaw).length,
  unicorn: Object.keys(unicornRaw).length,
  import: Object.keys(importRaw).length,
};
counts.total = counts.eslint + counts.typescript + counts.unicorn + counts.import;
console.log('ported rule counts:', JSON.stringify(counts));
