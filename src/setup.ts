import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import * as enquirer from "enquirer";
import { Listr } from "listr2";
import { parseCliArgs, isInteractiveMode, printHelp, createPackageCollector } from "./cli-args.ts";
import type { CliArgs, TaskContext } from "./cli-args.ts";
import { commitLintTasks } from "./convential-tasks.ts";
import { esLintTasks } from "./eslint-tasks.ts";
import { createGithubActionsTasks } from "./github-actions-tasks.ts";
import type { GithubActionsOptions } from "./github-actions-tasks.ts";
import { huskyTasks } from "./husky-tasks.ts";
import { jscpdTasks } from "./jscpd-tasks.ts";
import { knipTasks } from "./knip-tasks.ts";
import { lintstagedTasks } from "./lintstaged-tasks.ts";
import { semanticReleaseNotesTasks } from "./sematic-release-tasks.ts";
// import { detectTools } from "./tool-detection.ts";
import { tsTasks, createTsTasksWithArgs } from "./ts-tasks.ts";
import { detectPackageManager, updatePkgJson, updatePkgJsonScript } from "./utils.ts";
import { installPkg } from "./utils.ts";

// Type definitions for enquirer MultiSelect
type MultiSelectChoice = {
  name: string;
  value: string;
  enabled?: boolean;
  onChoice?: (state: MultiSelectState, choice: MultiSelectChoice, index: number) => void;
};

type MultiSelectState = {
  index: number;
  choices: Array<MultiSelectChoice>;
};

type MultiSelectOptions = {
  name: string;
  message: string;
  hint?: string;
  choices: Array<MultiSelectChoice>;
  result: (this: MultiSelectPrompt, names: Record<string, boolean>) => Array<string>;
  onSubmit: (this: MultiSelectPrompt) => void;
};

type MultiSelectPrompt = {
  run: () => Promise<Array<string>>;
  selected: Array<unknown>;
  focused: unknown;
  enable: (item: unknown) => void;
  map: (names: Record<string, boolean>) => Record<string, string>;
};

const { MultiSelect } = enquirer.default as unknown as { MultiSelect: new (options: MultiSelectOptions) => MultiSelectPrompt; };

type ToolDef = { name: string; value: string; };
const TOOL_DEFS: Array<ToolDef> = [
  { name: "TS", value: "ts" },
  { name: "ESLint", value: "eslint" },
  { name: "Husky", value: "husky" },
  { name: "CommitLint", value: "commitLint" },
  { name: "Lint-Staged", value: "lintStaged" },
  { name: "Semantic Release Notes", value: "semanticReleaseNotes" },
  { name: "Knip", value: "knip" },
  { name: "jscpd", value: "jscpd" },
  { name: "GitHub Actions", value: "githubActions" },
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
            enable(state.choices, ch => ch.name !== "none");
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
        task: async (ctx, task) => {
          ctx.cliArgs = cliArgs;
          ctx.packages = createPackageCollector();
          ctx.packageManager = await detectPackageManager(task, cliArgs.yes);
        },
      },
    ],
    {
      concurrent: false,
    }
  );
}

function addToolTasks(tasks: Listr<TaskContext>, answer: Array<string>, cliArgs: CliArgs): void {
  if (answer.includes("ts")) {
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
  if (answer.includes("eslint")) tasks.add({
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
  if (answer.includes("semanticReleaseNotes")) tasks.add({
    title: "Semantic Release Notes",
    task: async (_ctx, task) => task.newListr(semanticReleaseNotesTasks, { concurrent: false }),
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
            includeCache: true,
            includeCiTest: true,
            includeLint: answer.includes("eslint"),
            includeKnip: answer.includes("knip"),
            includeTsCheck: answer.includes("ts"),
            includeClaudePrReview: true,
            includeRelease: !cliArgs.noRelease && answer.includes("semanticReleaseNotes"),
          };
        }
        else {
          const selected: Array<string> = await task.prompt(ListrEnquirerPromptAdapter).run({
            type: "multiselect",
            name: "workflows",
            message: "Select GitHub Actions workflows to install:",
            choices: [
              { name: "cache", message: "Cache", enabled: true },
              { name: "ci_test", message: "CI Test", enabled: true },
              { name: "lint", message: "ESLint", enabled: answer.includes("eslint") },
              { name: "knip", message: "Knip", enabled: answer.includes("knip") },
              { name: "ts_check", message: "TypeScript Check", enabled: answer.includes("ts") },
              { name: "claude_pr_review", message: "Claude PR Review", enabled: true },
              { name: "release", message: "Release", enabled: answer.includes("semanticReleaseNotes") },
            ],
          });

          ghaOptions = {
            includeCache: selected.includes("cache"),
            includeCiTest: selected.includes("ci_test"),
            includeLint: selected.includes("lint"),
            includeKnip: selected.includes("knip"),
            includeTsCheck: selected.includes("ts_check"),
            includeClaudePrReview: selected.includes("claude_pr_review"),
            includeRelease: selected.includes("release"),
          };
        }

        return task.newListr(createGithubActionsTasks(ghaOptions), { concurrent: false });
      },
    });
  }

  // Add combined lint script based on selected tools
  const hasTs = answer.includes("ts");
  const hasEslint = answer.includes("eslint");
  if (hasTs || hasEslint) {
    tasks.add({
      title: "Adding combined lint script",
      task: async () => {
        const parts: Array<string> = [];
        if (hasTs) parts.push("pnpm lint:ts");
        if (hasEslint) parts.push("pnpm lint:fix");
        updatePkgJsonScript("lint", parts.join("; "));
        updatePkgJsonScript("lint:e18e", "pnpm dlx @e18e/cli analyze");
      },
    });
  }

  // Add pnpm.minimumReleaseAge to package.json
  tasks.add({
    title: "Configuring pnpm settings",
    task: async () => {
      updatePkgJson("pnpm", { minimumReleaseAge: 4320 });
    },
  });

  // Add engines field to package.json
  tasks.add({
    title: "Configuring engines",
    task: async () => {
      updatePkgJson("engines", { node: ">=24.0.0", pnpm: ">=10.0.0" });
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

    addToolTasks(tasks, selectedTools, cliArgs);
    await tasks.run();
  }
  else {
    // Interactive mode: use enquirer prompts
    try {
      const prompt = createPrompt(cliArgs.update);
      const answer = await prompt.run();
      // eslint-disable-next-line no-console
      console.log(answer);

      if (answer.length === 0) {
        // eslint-disable-next-line no-console
        console.log("Nothing to do.");
        return;
      }

      cliArgs.tools = answer;
      addToolTasks(tasks, answer, cliArgs);
      await tasks.run();
    }
    catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }
}

// eslint-disable-next-line no-console
main().catch(console.error);
