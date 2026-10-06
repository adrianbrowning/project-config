import { execSync } from "node:child_process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import * as enquirer from "enquirer";
import { Listr } from "listr2";
import { createBumpyTasks } from "./bumpy-tasks.ts";
import { createPackageCollector, isInteractiveMode, parseCliArgs, printHelp, TOOL_VALUES } from "./cli-args.ts";
import type { CliArgs, TaskContext } from "./cli-args.ts";
import { commitLintTasks } from "./convential-tasks.ts";
import { esLintTasks } from "./eslint-tasks.ts";
import { createGithubActionsTasks, usesWorkspaceCi } from "./github-actions-tasks.ts";
import type { ClaudeRunnerType, GithubActionsOptions } from "./github-actions-tasks.ts";
import { huskyTasks } from "./husky-tasks.ts";
import { jscpdTasks } from "./jscpd-tasks.ts";
import { knipTasks } from "./knip-tasks.ts";
import { lintstagedTasks } from "./lintstaged-tasks.ts";
import { combinedLintScript, E18E_SCRIPT, ENGINES, PNPM_SETTINGS } from "./project-defaults.ts";
import { createTsTasksWithArgs, tsTasks } from "./ts-tasks.ts";
import { runUpdate } from "./update/run-update.ts";
import type { UpdatePrompts } from "./update/run-update.ts";
import { detectPackageManager, updatePkgJson, updatePkgJsonScript, updateWorkspaceYaml } from "./utils.ts";
import { installPkg } from "./utils.ts";
import { addWorkspaceRootScripts, createWorkspaceTasks, promptUpdateAll } from "./workspace-tasks.ts";

// Type definitions for enquirer MultiSelect
type MultiSelectChoice = {
  enabled?: boolean;
  name: string;
  onChoice?: (state: MultiSelectState, choice: MultiSelectChoice, index: number) => void;
  value: string;
};

type MultiSelectState = {
  choices: Array<MultiSelectChoice>;
  index: number;
};

type MultiSelectOptions = {
  choices: Array<MultiSelectChoice>;
  hint?: string;
  message: string;
  name: string;
  onSubmit: (this: MultiSelectPrompt) => void;
  result: (this: MultiSelectPrompt, names: Record<string, boolean>) => Array<string>;
};

type MultiSelectPrompt = {
  enable: (item: unknown) => void;
  focused: unknown;
  map: (names: Record<string, boolean>) => Record<string, string>;
  run: () => Promise<Array<string>>;
  selected: Array<unknown>;
};

const { Confirm, MultiSelect } = enquirer.default as unknown as {
  Confirm: new (options: { initial: boolean; message: string; name: string; }) => { run: () => Promise<boolean>; };
  MultiSelect: new (options: MultiSelectOptions) => MultiSelectPrompt;
};

type ToolDef = { name: string; value: string; };
const TOOL_DEFS: Array<ToolDef> = [
  { name: "TS", value: "ts" },
  { name: "ESLint", value: "eslint" },
  { name: "Husky", value: "husky" },
  { name: "CommitLint", value: "commitLint" },
  { name: "Lint-Staged", value: "lintStaged" },
  { name: "Knip", value: "knip" },
  { name: "jscpd", value: "jscpd" },
  { name: "GitHub Actions", value: "githubActions" },
  { name: "Bumpy (releases)", value: "bumpy" },
  { name: "pnpm workspace (shared TS/ESLint)", value: "workspace" },
];

const enable = (choices: Array<MultiSelectChoice>, fn: (ch: MultiSelectChoice) => boolean) => choices.forEach(ch => (ch.enabled = fn(ch)));

/** The tool menu. With `detected` (update mode) it lists only those tools, all selected. */
function createPrompt(detected: Array<string> | null): MultiSelectPrompt {
  const shown = new Set(detected);
  const defs = detected ? TOOL_DEFS.filter(({ value }) => shown.has(value)) : TOOL_DEFS;
  const tools: Array<MultiSelectChoice> = defs.map(({ name, value }) => ({ name, value, enabled: detected !== null }));

  return new MultiSelect({
    name: "tool",
    message: detected ? "Select tools to update" : "Please select what to install",
    hint: "(Use <space> to select, <return> to submit)",
    choices: [
      {
        name: "All",
        value: "all",
        onChoice(state, choice, i) {
          if (state.index === i && choice.enabled) {
            // Setup's "All" leaves workspace off: it replaces the single-package TS/ESLint setup
            enable(state.choices, ch => ch.name !== "none" && (detected !== null || ch.value !== "workspace"));
          }
        },
      },
      ...tools,
    ],
    result(names) {
      return Object.values(this.map(names));
    },
    onSubmit() {
      if (this.selected.length === 0) {
        this.enable(this.focused);
      }
    },
  });
}

// Parse CLI arguments
const cliArgs = parseCliArgs();

// Show help and exit if requested
if (cliArgs.help) {
  printHelp();
  process.exit(0);
}

if (cliArgs.unknownTools.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`Unknown tool: ${cliArgs.unknownTools.map(tool => `--tool=${tool}`).join(", ")}. Valid tools: ${TOOL_VALUES.join(", ")}.`);
  process.exit(1);
}

function createTasks(cliArgs: CliArgs) {
  return new Listr<TaskContext>(
    [
      {
        title: "Detecting Package Manager",
        task: ctx => {
          ctx.cliArgs = cliArgs;
          ctx.packages = createPackageCollector();
          ctx.packageManager = detectPackageManager();
        },
      },
    ],
    {
      concurrent: false,
    }
  );
}

function addToolTasks(tasks: Listr<TaskContext>, answer: Array<string>, cliArgs: CliArgs, interactive: boolean): void {
  // Workspace writes shared root TS/ESLint configs itself, so the single-package ts/eslint tools step aside.
  // It runs first: it may create the root package.json that every later task reads.
  const workspace = answer.includes("workspace");
  if (workspace) tasks.add({
    title: "pnpm workspace",
    task: async (_ctx, task) => task.newListr(createWorkspaceTasks(cliArgs, interactive ? promptUpdateAll : null), { concurrent: false }),
  });
  if (answer.includes("ts") && !workspace) {
    tasks.add({
      title: "TypeScript",
      task: async (_ctx, task) => {
        // Use CLI args for TS config when in non-interactive mode
        if (cliArgs.yes) {
          return task.newListr(createTsTasksWithArgs(cliArgs), { concurrent: false });
        }
        return task.newListr(tsTasks, { concurrent: false });
      },
    });
  }
  if (answer.includes("eslint") && !workspace) tasks.add({
    title: "ESLint",
    task: async (_ctx, task) => task.newListr(esLintTasks, { concurrent: false }),
  });
  if (answer.includes("husky")) tasks.add({
    title: "Husky",
    task: async (_ctx, task) => task.newListr(huskyTasks, { concurrent: false }),
  });
  if (answer.includes("commitLint")) tasks.add({
    title: "CommitLint",
    task: async (_ctx, task) => task.newListr(commitLintTasks, { concurrent: false }),
  });
  if (answer.includes("lintStaged")) tasks.add({
    title: "LintStaged",
    task: async (_ctx, task) => task.newListr(lintstagedTasks, { concurrent: false }),
  });
  if (answer.includes("knip")) tasks.add({
    title: "Knip",
    task: async (_ctx, task) => task.newListr(knipTasks, { concurrent: false }),
  });
  if (answer.includes("jscpd")) tasks.add({
    title: "jscpd",
    task: async (_ctx, task) => task.newListr(jscpdTasks, { concurrent: false }),
  });

  if (answer.includes("githubActions")) {
    tasks.add({
      title: "GitHub Actions",
      task: async (_ctx, task) => {
        let ghaOptions: GithubActionsOptions;
        // A workspace being set up now, or one that already lists packages, gets the root CI workflow instead
        const workspace = usesWorkspaceCi(answer.includes("workspace"));

        if (cliArgs.yes) {
          ghaOptions = {
            includeCiTest: true,
            includeLint: answer.includes("eslint"),
            includeKnip: answer.includes("knip"),
            includeTsCheck: answer.includes("ts"),
            includeClaudePrReview: true,
            claudeRunnerType: cliArgs.claudeRunner,
            workspace,
          };
        }
        else {
          const selected: Array<string> = await task.prompt(ListrEnquirerPromptAdapter).run({
            type: "multiselect",
            name: "workflows",
            message: "Select GitHub Actions workflows to install:",
            choices: [
              ...(workspace
                ? [{ name: "workspace_ci", message: "Workspace CI (lint, type-check, test, build)", enabled: true }]
                : [
                  { name: "ci_test", message: "CI Test", enabled: true },
                  { name: "lint", message: "ESLint", enabled: answer.includes("eslint") },
                  { name: "ts_check", message: "TypeScript Check", enabled: answer.includes("ts") },
                ]),
              { name: "knip", message: "Knip", enabled: answer.includes("knip") },
              { name: "claude_pr_review", message: "Claude PR Review", enabled: true },
            ],
          });

          let claudeRunnerType: ClaudeRunnerType = "anthropic";
          if (selected.includes("claude_pr_review")) {
            claudeRunnerType = await task.prompt(ListrEnquirerPromptAdapter).run({
              type: "select",
              name: "claudeRunner",
              message: "How should Claude Code PR review be run?",
              choices: [
                { name: "anthropic", message: "Anthropic API (ANTHROPIC_API_KEY secret)" },
                { name: "bedrock", message: "AWS Bedrock (AWS credentials + region)" },
              ],
            });
          }

          ghaOptions = {
            includeCiTest: selected.includes("ci_test"),
            includeLint: selected.includes("lint"),
            includeKnip: selected.includes("knip"),
            includeTsCheck: selected.includes("ts_check"),
            includeClaudePrReview: selected.includes("claude_pr_review"),
            claudeRunnerType,
            workspace: selected.includes("workspace_ci"),
          };
        }

        // ci.yml runs the workspace's root scripts: add any that are missing (setup keeps scripts the user wrote)
        if (ghaOptions.workspace && !answer.includes("workspace")) addWorkspaceRootScripts();

        return task.newListr(createGithubActionsTasks(ghaOptions), { concurrent: false });
      },
    });
  }

  if (answer.includes("bumpy")) {
    tasks.add({
      title: "Bumpy",
      task: async (_ctx, task) => {
        const npm = cliArgs.releaseNpm || (!cliArgs.yes && await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
          type: "confirm",
          name: "npm",
          message: "GitHub releases are always created. Also publish to npm? (adds `release-rc` label snapshots to @next)",
          initial: false,
        }));
        return task.newListr(createBumpyTasks({ npm }), { concurrent: false });
      },
    });
  }

  // Add combined lint script based on selected tools
  const hasTs = answer.includes("ts") && !workspace;
  const hasEslint = answer.includes("eslint") && !workspace;
  if (hasTs || hasEslint) {
    tasks.add({
      title: "Adding combined lint script",
      task: async () => {
        updatePkgJsonScript("lint", combinedLintScript(hasTs, hasEslint));
        updatePkgJsonScript("lint:e18e", E18E_SCRIPT);
      },
    });
  }

  // Add engines field to package.json
  tasks.add({
    title: "Configuring engines",
    task: async () => {
      updatePkgJson("engines", ENGINES);
    },
  });

  // Set packageManager field for pnpm/action-setup and corepack
  tasks.add({
    title: "Setting packageManager field",
    task: () => {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const version = execSync("pnpm --version").toString()
        .trim();
      updatePkgJson("packageManager", `pnpm@${version}`);
    },
  });

  // Final task: install all collected packages at once
  tasks.add({
    title: "Installing packages",
    skip: ctx => ctx.packages.packages.size === 0,
    task: ctx => {
      const pkgList = [ ...ctx.packages.packages ].join(" ");
      installPkg(ctx.packageManager, pkgList);
    },
  });

  // pnpm supply-chain settings (see project-defaults.ts). Written after the install: peers auto-installed
  // with this package can be younger than minimumReleaseAge, which would fail setup.
  tasks.add({
    title: "Configuring pnpm settings",
    task: async () => {
      updateWorkspaceYaml(PNPM_SETTINGS);
    },
  });
}

// Main execution
async function main() {
  if (cliArgs.update) {
    const interactive = isInteractiveMode(cliArgs);
    const prompts: null | UpdatePrompts = interactive
      ? {
        chooseTools: async detected => {
          const answer = new Set(await createPrompt(detected).run());
          return detected.filter(tool => answer.has(tool));
        },
        confirmOverwrite: async item => new Confirm({
          name: "overwrite",
          message: `${item.label} ${item.reason ?? "was changed"}. Overwrite it with the current default?`,
          initial: false,
        }).run(),
      }
      : null;
    // eslint-disable-next-line no-console
    process.exitCode = await runUpdate(cliArgs, prompts, line => console.log(line));
    return;
  }

  const tasks = createTasks(cliArgs);

  // Check if running in non-interactive mode
  if (!isInteractiveMode(cliArgs)) {
    // Non-interactive mode: use CLI args for tool selection
    const selectedTools = cliArgs.tools;
    // eslint-disable-next-line no-console
    console.log(`Running in non-interactive mode with tools: ${selectedTools.join(", ")}`);

    if (selectedTools.length === 0) {
      // eslint-disable-next-line no-console
      console.log("No tools selected. Use --all or --tool=<name> to select tools.");
      process.exit(1);
    }

    addToolTasks(tasks, selectedTools, cliArgs, false);
    await tasks.run();
  }
  else {
    // Interactive mode: use enquirer prompts
    const prompt = createPrompt(null);
    const answer = await prompt.run();
    // eslint-disable-next-line no-console
    console.log(answer);

    if (answer.length === 0) {
      // eslint-disable-next-line no-console
      console.log("Nothing to do.");
      return;
    }

    cliArgs.tools = answer;
    addToolTasks(tasks, answer, cliArgs, true);
    await tasks.run();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
