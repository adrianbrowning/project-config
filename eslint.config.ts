import type { Linter } from "eslint";
import { config as defaultConfig } from "./src/eslint";

const config: Array<Linter.Config> = [ ...defaultConfig ];

export default config;
