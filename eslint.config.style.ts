import type { Linter } from "eslint";
import defaultConfig from "./src/eslint.styled.ts";

const config: Array<Linter.Config> = [ ...defaultConfig ];

export default config;
