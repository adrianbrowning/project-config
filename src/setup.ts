import { execSync } from "node:child_process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import * as enquirer from "enquirer";
import { Listr } from "listr2";
import { createBumpyTasks } from "./bumpy-tasks.ts";
import { createPackageCollector, isInteractiveMode, parseCliArgs, printHelp } from "./cli-args.ts";
import type { CliArgs, TaskContext } from "./cli-args.ts";
import { commitLintTasks } from "./convential-tasks.ts";
import { esLintTasks } from "./eslint-tasks.ts";
import { createGithubActionsTasks } from "./github-actions-tasks.ts";
import type { ClaudeRunnerType, GithubActionsOptions } from "./github-actions-tasks.ts";
import { huskyTasks } from "./husky-tasks.ts";
import { jscpdTasks } from "./jscpd-tasks.ts";
import { knipTasks } from "./knip-tasks.ts";
import { lintstagedTasks } from "./lintstaged-tasks.ts";
// import { detectTools } from "./tool-detection.ts";
import { createTsTasksWithArgs, tsTasks } from "./ts-tasks.ts";
import { detectPackageManager, updatePkgJson, updatePkgJsonScript, updateWorkspaceYaml } from "./utils.ts";
import { installPkg } from "./utils.ts";
import { createWorkspaceTasks, promptUpdateAll } from "./workspace-tasks.ts";

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

const { MultiSelect } = enquirer.default as unknown as { MultiSelect: new (options: MultiSelectOptions) => MultiSelectPrompt; };

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

function createPrompt(updateMode: boolean): MultiSelectPrompt {
  // const detected = updateMode ? detectTools() : null;

  const tools: Array<MultiSelectChoice> = TOOL_DEFS.map(({ name, value }) => {
    const installed = false; //detected?.[value as keyof typeof detected]?.installed ?? false;
    const label = name;/* detected
    // eslint-disable-next-line sonarjs/no-nested-conditional
      ? installed
        ? `${name} (installed)` : `${name} (NEW)`
      : name;*/
    return { name: label, value, enabled: installed };
  });

  return new MultiSelect({
    name: "tool",
    message: updateMode ? "Select tools to update" : "Please select what to install",
    hint: "(Use <space> to select, <return> to submit)",
    choices: [
      {
        name: "All",
        value: "all",
        onChoice(state, choice, i) {
          if (state.index === i && choice.enabled) {
            // "All" leaves workspace off: it replaces the single-package TS/ESLint setup
            enable(state.choices, ch => ch.name !== "none" && ch.value !== "workspace");
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

        if (cliArgs.yes) {
          ghaOptions = {
            includeCiTest: true,
            includeLint: answer.includes("eslint"),
            includeKnip: answer.includes("knip"),
            includeTsCheck: answer.includes("ts"),
            includeClaudePrReview: true,
            claudeRunnerType: "anthropic",
          };
        }
        else {
          const selected: Array<string> = await task.prompt(ListrEnquirerPromptAdapter).run({
            type: "multiselect",
            name: "workflows",
            message: "Select GitHub Actions workflows to install:",
            choices: [
              { name: "ci_test", message: "CI Test", enabled: true },
              { name: "lint", message: "ESLint", enabled: answer.includes("eslint") },
              { name: "knip", message: "Knip", enabled: answer.includes("knip") },
              { name: "ts_check", message: "TypeScript Check", enabled: answer.includes("ts") },
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
          };
        }

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
        const parts: Array<string> = [];
        if (hasTs) parts.push("pnpm lint:ts");
        if (hasEslint) parts.push("pnpm lint:esl");
        if (hasEslint) parts.push("pnpm lint:fix");
        updatePkgJsonScript("lint", parts.join(" && "));
        updatePkgJsonScript("lint:e18e", "pnpm dlx @e18e/cli analyze");
      },
    });
  }

  // Add engines field to package.json
  tasks.add({
    title: "Configuring engines",
    task: async () => {
      updatePkgJson("engines", { node: ">=24.0.0", pnpm: ">=10.0.0" });
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

  // pnpm supply-chain settings, written as top-level keys in pnpm-workspace.yaml. Written after the install:
  // peers auto-installed with this package can be younger than minimumReleaseAge, which would fail setup.
  // strictDepBuilds fails installs on unreviewed build scripts. unrs-resolver (via eslint-plugin-import-x) is
  // already installed with its build ignored; pnpm 10 keeps failing on that recorded state under `false`, so
  // approve it (napi-postinstall only checks for its prebuilt native binding).
  tasks.add({
    title: "Configuring pnpm settings",
    task: async () => {
      updateWorkspaceYaml({ minimumReleaseAge: 4320, blockExoticSubdeps: true, trustPolicy: "no-downgrade", trustPolicyIgnoreAfter: 43200, minimumReleaseAgeExclude: [ "@gingacodemonkey/config" ], strictDepBuilds: true, allowBuilds: { "unrs-resolver": true } });
    },
  });
}

// Main execution
async function main() {
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
    // const prompt = createPrompt(cliArgs.update);
    const prompt = createPrompt(false);
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
