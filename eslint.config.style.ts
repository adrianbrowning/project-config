import type { Linter } from "eslint";
import { extraRules } from "./eslint.config.ts";
import defaultConfig from "./src/eslint.styled.ts";

const config: Array<Linter.Config> = [
  ...defaultConfig,
  ...extraRules,
];

export default config;
