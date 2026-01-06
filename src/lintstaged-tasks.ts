import fs from "node:fs";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import type { TaskContext } from "./cli-args.ts";
import { compareVersions, getPkgVersion, writeConfigFile } from "./utils.ts";

const Supported_Version = "__lintstaged_version__";
const pkgName = "lint-staged";

const configFile = {
  path: ".lintstagedrc",
  content: {
    "*.{js,ts,tsx}": [ "pnpm lint:fix" ],
  },
};

export const lintstagedTasks: Array<ListrTask<TaskContext>> = [
  {
    title: "Checking if LintStaged is installed",
    task: async (ctx, task) => {
      const eslintInstalled = getPkgVersion(pkgName);
      if (!eslintInstalled) {
        task.title = "LintStaged not installed. Installing...";
        ctx.packages.add(`${pkgName}@${Supported_Version}`);
        return;
      }

      ctx.tsVersion = eslintInstalled;
      task.title = `LintStaged version ${eslintInstalled} detected`;

      if (compareVersions(eslintInstalled, Supported_Version) < 0) {
        const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
          type: "confirm",
          name: "upgrade",
          message: `Your LintStaged version is below ${Supported_Version}. Would you like to upgrade to the supported version?`,
        });
        if (upgrade) {
          return task.newListr([{
            title: "Upgrading LintStaged to the supported version...",
            task: async ctx => {
              ctx.packages.add(`${pkgName}@${Supported_Version}`);
            },
          }],
          { concurrent: false });
        }
        task.skip("Skipping LintStaged upgrade.");
        // throw new Error('Task aborted due to outdated LintStaged version');
      }
      return;
    },
  },
  {
    title: `Adding ${configFile.path} file`,
    task: writeConfigFile(configFile.path, JSON.stringify(configFile.content, null, 2)),
  },
  {
    title: "Configuring pre-commit hook for lint-staged",
    task: async () => {
      const hookPath = ".husky/pre-commit";
      const lintStagedCommand = "pnpm exec lint-staged";

      // Create .husky directory if it doesn't exist
      if (!fs.existsSync(".husky")) {
        fs.mkdirSync(".husky", { recursive: true });
      }

      // Check if pre-commit exists and if lint-staged is already configured
      if (fs.existsSync(hookPath)) {
        const content = fs.readFileSync(hookPath, "utf-8");
        if (!content.includes("lint-staged")) {
          // Append lint-staged to existing hook
          fs.appendFileSync(hookPath, `\n${lintStagedCommand}\n`);
        }
      }
      else {
        // Create new pre-commit hook
        fs.writeFileSync(hookPath, lintStagedCommand);
      }
    },
  },
];
