import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const typedTypeScriptFiles = ["src/**/*.{ts,tsx}", "worker/**/*.ts", "*.config.ts"];
const sourceFiles = ["src/**/*.{ts,tsx}"];
const testTypeScriptFiles = [
  "src/**/*.test.{ts,tsx}",
  "src/test/**/*.{ts,tsx}",
  "worker/**/*.test.ts",
  "vitest.config.ts",
];

export default tseslint.config(
  {
    ignores: ["coverage/**", "dist/**", "dist-worker/**", "node_modules/**"],
  },
  {
    files: typedTypeScriptFiles,
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 3,
        },
      ],
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/require-array-sort-compare": "error",
      "@typescript-eslint/no-unnecessary-qualifier": "error",
      eqeqeq: "error",
      "object-shorthand": "error",
      "no-implicit-coercion": "error",
      "no-else-return": "error",
      "no-lonely-if": "error",
      "prefer-arrow-callback": "error",
      "arrow-body-style": "error",
      "@typescript-eslint/method-signature-style": "error",
      "@typescript-eslint/promise-function-async": "error",
      "@typescript-eslint/no-shadow": "error",
      // An override's shape is fixed by its base class.
      "@typescript-eslint/class-methods-use-this": ["error", { ignoreOverrideMethods: true }],
      "@typescript-eslint/max-params": "error",
      "no-console": "error",
      "no-param-reassign": "error",
      "no-nested-ternary": "error",
      "prefer-template": "error",
      curly: "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "JSON",
          property: "parse",
          message:
            "Read JSON as unknown with Response.json() or parseJson() from src/api/wire.ts, and validate it completely.",
        },
      ],
    },
  },
  {
    // The rules of React the React Compiler assumes.
    files: sourceFiles,
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      // The preset leaves these at "warn".
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/incompatible-library": "error",
      "react-hooks/unsupported-syntax": "error",
      // Compiler checks the preset omits.
      "react-hooks/capitalized-calls": "error",
      "react-hooks/component-hook-factories": "error",
      "react-hooks/exhaustive-effect-dependencies": "error",
      "react-hooks/memo-dependencies": "error",
      "react-hooks/memoized-effect-dependencies": "error",
      "react-hooks/no-deriving-state-in-effects": "error",
      "react-hooks/rule-suppression": "error",
      "react-hooks/void-use-memo": "error",
    },
  },
  {
    files: typedTypeScriptFiles,
    ignores: testTypeScriptFiles,
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "never",
        },
      ],
    },
  },
  {
    // parseJson() is the one place JSON text becomes a value; it returns unknown.
    files: ["src/api/wire.ts"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  {
    files: testTypeScriptFiles,
    rules: {
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
);
