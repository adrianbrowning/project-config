import * as enquirer from "enquirer";
import { Listr } from "listr2";
import { parseCliArgs, isInteractiveMode, printHelp, createPackageCollector } from "./cli-args.ts";
import type { CliArgs, TaskContext } from "./cli-args.ts";
import { commitLintTasks } from "./convential-tasks.ts";
import { esLintTasks } from "./eslint-tasks.ts";
import { createGithubActionsTasks } from "./github-actions-tasks.ts";
import { huskyTasks } from "./husky-tasks.ts";
import { knipTasks } from "./knip-tasks.ts";
import { lintstagedTasks } from "./lintstaged-tasks.ts";
import { semanticReleaseNotesTasks } from "./sematic-release-tasks.ts";
import { tsTasks, createTsTasksWithArgs } from "./ts-tasks.ts";
import { detectPackageManager, updatePkgJson, updatePkgJsonScript } from "./utils.ts";
import { installPkg } from "./utils.ts";

const { MultiSelect } = enquirer.default as any;

const tools = [
  { name: "TS", value: "ts" },
  { name: "ESLint", value: "eslint" },
  { name: "Husky", value: "husky" },
  { name: "CommitLint", value: "commitLint" },
  { name: "Lint-Staged", value: "lintStaged" },
  { name: "Semantic Release Notes", value: "semanticReleaseNotes" },
  { name: "Knip", value: "knip" },
];
const enable = (choices: any, fn: any) => choices.forEach((ch: any) => (ch.enabled = fn(ch)));
const prompt = new MultiSelect({
  name: "tool",
  message: "Please select what to install",
  hint: "(Use <space> to select, <return> to submit)",
  choices: [
    {
      name: "All",
      value: "all",
      onChoice(state: any, choice: any, i: number) {
        if (state.index === i && choice.enabled) {
          enable(state.choices, (ch: any) => ch.name !== "none");
        }
      },
    },
    ...tools,
  ],
  result(names: any) {
    return Object.values(this.map(names));
  },
  onSubmit() {
    if (this.selected.length === 0) {
      this.enable(this.focused);
    }
  },
});

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

  // Always add GitHub Actions workflows (cache and ci_test are always included)
  const githubActionsTasks = createGithubActionsTasks({
    includeCache: true,
    includeCiTest: true,
    includeLint: answer.includes("eslint"),
    includeKnip: answer.includes("knip"),
    includeTsCheck: answer.includes("ts"),
  });

  tasks.add({
    title: "GitHub Actions",
    task: async (_ctx, task) => task.newListr(githubActionsTasks, { concurrent: false }),
  });

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
    console.log(`Running in non-interactive mode with tools: ${selectedTools.join(", ")}`);

    if (selectedTools.length === 0) {
      console.log("No tools selected. Use --all or --tool=<name> to select tools.");
      process.exit(1);
    }

    addToolTasks(tasks, selectedTools, cliArgs);
    await tasks.run();
  }
  else {
    // Interactive mode: use enquirer prompts
    try {
      const answer = await prompt.run();
      console.log(answer);

      if (answer.length === 0) {
        console.log("Nothing to do.");
        return;
      }

      addToolTasks(tasks, answer, cliArgs);
      await tasks.run();
    }
    catch (error) {
      console.error(error);
    }
  }
}

main().catch(console.error);
