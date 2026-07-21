import type { Linter } from "eslint";
import defaultConfig from "./src/eslint.ts";

export const extraRules: Array<Linter.Config> = [{
  files: [ "tests/**/*" ],
  rules: {
    "vitest/expect-expect": "off",
  },
}];

const config: Array<Linter.Config> = [
  ...defaultConfig,
  ...extraRules,
];

export default config;
