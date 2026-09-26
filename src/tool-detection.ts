import fs from "node:fs";
import path from "node:path";

export type ToolStatus = {
  installed: boolean;
  sentinelFile: string;
};

export type DetectedTools = {
  bumpy: ToolStatus;
  commitLint: ToolStatus;
  eslint: ToolStatus;
  githubActions: ToolStatus;
  husky: ToolStatus;
  jscpd: ToolStatus;
  knip: ToolStatus;
  lintStaged: ToolStatus;
  ts: ToolStatus;
};

const SENTINELS: Record<keyof DetectedTools, string> = {
  ts: "tsconfig.json",
  eslint: "eslint.config.ts",
  husky: ".husky",
  commitLint: "commitlint.config.js",
  lintStaged: ".lintstagedrc",
  knip: "knip.json",
  jscpd: ".jscpd.json",
  githubActions: path.join(".github", "workflows"),
  bumpy: ".bumpy",
};

export function detectTools(cwd: string = process.cwd()): DetectedTools {
  const result = {} as DetectedTools;
  for (const [ tool, sentinel ] of Object.entries(SENTINELS) as Array<[keyof DetectedTools, string]>) {
    const full = path.join(cwd, sentinel);
    result[tool] = { installed: fs.existsSync(full), sentinelFile: sentinel };
  }
  return result;
}
