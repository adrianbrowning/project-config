import fs from "node:fs";
import path from "node:path";

/** Tools `--update` can reconcile, with the file or directory whose presence shows the tool is set up. */
const SENTINELS = {
  ts: "tsconfig.json",
  eslint: "eslint.config.ts",
  husky: ".husky",
  commitLint: "commitlint.config.js",
  lintStaged: ".lintstagedrc",
  knip: "knip.json",
  jscpd: ".jscpd.json",
  githubActions: path.join(".github", "workflows"),
  bumpy: ".bumpy",
  workspace: "sharedConfig",
} as const;

export type DetectableTool = keyof typeof SENTINELS;

export const DETECTABLE_TOOLS = Object.keys(SENTINELS) as Array<DetectableTool>;

/** Tools set up in `cwd`, in a stable order. */
export function detectTools(cwd: string = process.cwd()): Array<DetectableTool> {
  return DETECTABLE_TOOLS.filter(tool => fs.existsSync(path.join(cwd, SENTINELS[tool])));
}
