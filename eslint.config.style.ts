import type { Linter } from "eslint";
import { config as defaultConfig } from "./src/eslint.styled";

const config: Array<Linter.Config> = [ ...defaultConfig ];

export default config;
