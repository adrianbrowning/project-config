import type { Linter } from "eslint";
import defaultConfig from "./src/eslint.ts";

export const extraRules: Array<Linter.Config> = [{
  files: [ "tests/**/*" ],
  rules: {
    "vitest/expect-expect": "off",
  },
}, {
  // .ts only: the shipped config's own no-restricted-syntax applies to .tsx/.jsx, and a second one would replace it
  files: [ "src/**/*.ts", "tests/**/*.ts" ],
  rules: {
    "no-restricted-syntax": [ "error", {
      selector: "TSTypeReference[typeName.name='ReturnType'] TSTypeQuery",
      message: "Export a named type from the module that owns the function and import it, instead of ReturnType<typeof fn>.",
    }],
  },
}];

const config: Array<Linter.Config> = [
  ...defaultConfig,
  ...extraRules,
];

export default config;
