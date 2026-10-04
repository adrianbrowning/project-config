/**
 * What `--update` manages for each tool: the files and keys the CLI owns, their current defaults, and the
 * earlier defaults it may replace. Anything not listed here is never touched by update.
 */
import fs from "node:fs";
import path from "node:path";
import { BUMPY_CHECK_WORKFLOW, BUMPY_COMMENT_WORKFLOW, BUMPY_SCRIPTS, createBumpyConfig, RELEASE_GITHUB_WORKFLOW, RELEASE_NPM_WORKFLOW } from "../bumpy-tasks.ts";
import { COMMITLINT_CONFIG } from "../convential-tasks.ts";
import { ESLINT_SCRIPTS, eslintConfigContent } from "../eslint-tasks.ts";
import { CI_TEST_WORKFLOW, CLAUDE_PR_REVIEW_BEDROCK_WORKFLOW, CLAUDE_PR_REVIEW_WORKFLOW, KNIP_WORKFLOW, LINT_WORKFLOW, SETUP_ACTION, SETUP_ACTION_PATH, TS_CHECK_WORKFLOW } from "../github-actions-tasks.ts";
import { COMMIT_MSG_HOOK, PRE_COMMIT_PLACEHOLDER, PRE_PUSH_HOOK } from "../husky-tasks.ts";
import { JSCPD_CONFIG } from "../jscpd-tasks.ts";
import { KNIP_CONFIG } from "../knip-tasks.ts";
import { LINT_STAGED_HOOK, LINTSTAGED_CONFIG } from "../lintstaged-tasks.ts";
import { combinedLintScript, E18E_SCRIPT, ENGINES, PNPM_SETTINGS } from "../project-defaults.ts";
import type { DetectableTool } from "../tool-detection.ts";
import { discoverPackages, PACKAGE_SCRIPTS, packageEslintLink, readWorkspaceGlobs, ROOT_SCRIPTS, SHARED_DIR } from "../workspace-tasks.ts";
import { jsonFile, manifestEntry, pnpmSetting, templateFile } from "./reconcile.ts";
import type { PlanItem } from "./reconcile.ts";

// .lintstagedrc as written by earlier releases
const PREVIOUS_LINTSTAGED_CONFIGS: Array<unknown> = [
  { "*.{js,ts,tsx}": [ "eslint --config eslint.config.style.ts --fix --max-warnings=0 --cache" ] },
  { "*.{js,ts,tsx}": [ "pnpm lint:fix" ] },
  { "*.{js,ts,jsx,tsx}": [ "eslint --config eslint.config.style.ts --fix --cache" ] },
  { "*.{js,ts,jsx,tsx}": [ "eslint --config eslint.config.style.ts --fix --cache --no-warn-ignored" ] },
];

const MANIFEST = "package.json";

function scripts(manifest: string, entries: Record<string, string>): Array<PlanItem> {
  return Object.entries(entries).map(([ name, command ]) => manifestEntry(manifest, "scripts", name, command));
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  catch {
    return undefined;
  }
}

/** Workflow files are optional: a workflow the user deleted stays deleted. */
function workflow(name: string, current: string): PlanItem {
  return templateFile(`.github/workflows/${name}`, current, { optional: true });
}

function githubActionsItems(): Array<PlanItem> {
  // Keep whichever Claude runner the project already uses
  const review = ".github/workflows/claude-pr-review.yml";
  const bedrock = fs.existsSync(review) && fs.readFileSync(review, "utf8").includes("use_bedrock: true");
  return [
    templateFile(SETUP_ACTION_PATH, SETUP_ACTION),
    workflow("ci_test.yml", CI_TEST_WORKFLOW),
    workflow("lint.yml", LINT_WORKFLOW),
    workflow("knip.yml", KNIP_WORKFLOW),
    workflow("ts-check.yml", TS_CHECK_WORKFLOW),
    workflow("claude-pr-review.yml", bedrock ? CLAUDE_PR_REVIEW_BEDROCK_WORKFLOW : CLAUDE_PR_REVIEW_WORKFLOW),
  ];
}

function bumpyItems(): Array<PlanItem> {
  const configFile = ".bumpy/_config.json";
  const existing = readJson(configFile);
  // Keep the release mode the project chose: npm publishing configs carry a `publish` block
  const npm = existing !== null && typeof existing === "object" && "publish" in existing;
  const manifest = readJson(MANIFEST);
  const name = manifest !== null && typeof manifest === "object" && "name" in manifest ? String(manifest.name) : "";
  return [
    jsonFile(configFile, createBumpyConfig(name, npm), [], { userEditable: true }),
    workflow("bumpy-check.yml", BUMPY_CHECK_WORKFLOW),
    workflow("bumpy-comment.yml", BUMPY_COMMENT_WORKFLOW),
    workflow("release.yml", npm ? RELEASE_NPM_WORKFLOW : RELEASE_GITHUB_WORKFLOW),
    ...scripts(MANIFEST, BUMPY_SCRIPTS),
  ];
}

/** Packages already linked to sharedConfig/; update keeps them current but never links new ones. */
function workspaceItems(): Array<PlanItem> {
  const items: Array<PlanItem> = [
    templateFile(path.join(SHARED_DIR, "eslint.config.ts"), eslintConfigContent("eslint"), { knownKey: "eslint.config.ts", userEditable: true }),
    templateFile(path.join(SHARED_DIR, "eslint.config.style.ts"), eslintConfigContent("styled"), { knownKey: "eslint.config.style.ts" }),
    ...scripts(MANIFEST, ROOT_SCRIPTS),
  ];
  for (const dir of discoverPackages(readWorkspaceGlobs() ?? [])) {
    const shared = path.posix.relative(dir, SHARED_DIR);
    const link = path.join(dir, "eslint.config.ts");
    const linked = fs.existsSync(link) && fs.readFileSync(link, "utf8").includes(`${shared}/eslint.config.ts`);
    if (!linked) continue;
    items.push(
      ...scripts(path.join(dir, MANIFEST), PACKAGE_SCRIPTS),
      templateFile(link, packageEslintLink(shared, "eslint.config.ts")),
      templateFile(path.join(dir, "eslint.config.style.ts"), packageEslintLink(shared, "eslint.config.style.ts"))
    );
  }
  return items;
}

type ToolItems = (detected: ReadonlyArray<DetectableTool>) => Array<PlanItem>;

// In a workspace, sharedConfig/ and the root `pnpm -r` scripts (workspace tool) replace the single-package ones
const singlePackage = (detected: ReadonlyArray<DetectableTool>) => !detected.includes("workspace");

const TOOL_ITEMS: Record<DetectableTool, ToolItems> = {
  ts: detected => (singlePackage(detected) ? [ manifestEntry(MANIFEST, "scripts", "lint:ts", "tsc --noEmit") ] : []),
  eslint: () => [
    templateFile("eslint.config.ts", eslintConfigContent("eslint"), { userEditable: true }),
    templateFile("eslint.config.style.ts", eslintConfigContent("styled")),
    ...scripts(MANIFEST, ESLINT_SCRIPTS),
  ],
  husky: () => [
    templateFile(".husky/commit-msg", COMMIT_MSG_HOOK),
    templateFile(".husky/pre-push", PRE_PUSH_HOOK, { optional: true }),
  ],
  commitLint: () => [ templateFile("commitlint.config.js", COMMITLINT_CONFIG, { userEditable: true }) ],
  lintStaged: detected => [
    jsonFile(".lintstagedrc", LINTSTAGED_CONFIG, PREVIOUS_LINTSTAGED_CONFIGS, { userEditable: true }),
    ...(detected.includes("husky") ? [ templateFile(".husky/pre-commit", LINT_STAGED_HOOK, { alsoKnown: [ PRE_COMMIT_PLACEHOLDER ] }) ] : []),
  ],
  knip: () => [ jsonFile("knip.json", KNIP_CONFIG, [], { userEditable: true }), manifestEntry(MANIFEST, "scripts", "lint:knip", "knip") ],
  jscpd: () => [ jsonFile(".jscpd.json", JSCPD_CONFIG, [], { userEditable: true }), manifestEntry(MANIFEST, "scripts", "lint:jscpd", "jscpd .") ],
  githubActions: () => githubActionsItems(),
  bumpy: () => bumpyItems(),
  workspace: () => workspaceItems(),
};

/** The root `lint` script combines ts and eslint, so it's managed when either is updated. */
function combinedLintItems(selected: ReadonlyArray<DetectableTool>, detected: ReadonlyArray<DetectableTool>): Array<PlanItem> {
  if (!singlePackage(detected) || (!selected.includes("ts") && !selected.includes("eslint"))) return [];
  return [
    manifestEntry(MANIFEST, "scripts", "lint", combinedLintScript(detected.includes("ts"), detected.includes("eslint"))),
    manifestEntry(MANIFEST, "scripts", "lint:e18e", E18E_SCRIPT),
  ];
}

/**
 * Plan items for the selected tools. `detected` is every tool set up in the project: shared values such as the
 * root `lint` script depend on all of them, not just the ones being updated. `includeRoot` adds the pnpm settings
 * and `engines` every setup run writes; an explicit `--tool` subset leaves them out.
 */
export function managedItems(selected: ReadonlyArray<DetectableTool>, detected: ReadonlyArray<DetectableTool>, includeRoot: boolean): Array<PlanItem> {
  const items: Array<PlanItem> = [
    ...(includeRoot ? Object.entries(PNPM_SETTINGS).map(([ key, value ]) => pnpmSetting(key, value)) : []),
    ...(includeRoot ? Object.entries(ENGINES).map(([ key, value ]) => manifestEntry(MANIFEST, "engines", key, value)) : []),
    ...combinedLintItems(selected, detected),
    ...selected.flatMap(tool => TOOL_ITEMS[tool](detected)),
  ];

  // Two tools can own the same entry (e.g. scripts); the first one wins
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}
