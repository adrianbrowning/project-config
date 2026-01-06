import fs from "node:fs";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask, ListrTaskWrapper } from "listr2";
import type { TaskContext } from "./cli-args.ts";
import type { YES_ANY_IS_OK_HERE } from "./types";
import { compareVersions, getPkgVersion } from "./utils.ts";

const Supported_Version = "__eslint_version__";

export const esLintTasks: Array<ListrTask<TaskContext>> = [
  {
    title: "Checking if ESLint is installed",
    task: async (ctx, task) => {
      const eslintInstalled = getPkgVersion("@eslint/js");
      if (!eslintInstalled) {
        task.title = "ESLint not installed. Installing...";
        // ctx.packages.add(`@eslint/js@${Supported_Version}`);
        ctx.packages.add("eslint");
        // ctx.packages.add("typescript-eslint");
        return;
      }

      ctx.tsVersion = eslintInstalled;
      task.title = `ESLint version ${eslintInstalled} detected`;

      if (compareVersions(eslintInstalled, Supported_Version) < 0) {
        const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
          type: "confirm",
          name: "upgrade",
          message: `Your ESLint version is below ${Supported_Version}. Would you like to upgrade to the supported version?`,
        });
        if (upgrade) {
          return task.newListr([{
            title: "Upgrading ESLint to the supported version...",
            task: async ctx => {
              // ctx.packages.add(`@eslint/js@${Supported_Version}`);
              ctx.packages.add("eslint");
              // ctx.packages.add("typescript-eslint");
            },
          }],
          { concurrent: false });
        }
        task.skip("Skipping ESLint upgrade.");
        // throw new Error('Task aborted due to outdated ESLint version');
      }
      return undefined;
    },
  },
  {
    title: "eslint.config.ts",
    task: eslintConfigFile("eslint.config.ts", "eslint"),
  },
  {
    title: "eslint.config.style.ts",
    task: eslintConfigFile("eslint.config.style.ts", "styled"),
  },
  {
    title: "Adding lint scripts to package.json",
    task: async () => {
      const { updatePkgJsonScript } = await import("./utils.ts");
      updatePkgJsonScript("lint:esl", "eslint --config eslint.config.ts \"src/**/*.{j,t}s{,x}\" --cache --max-warnings=0");
      updatePkgJsonScript("lint:s", "eslint --config eslint.config.style.ts \"src/**/*.{j,t}s{,x}\" --cache --max-warnings=0");
      updatePkgJsonScript("lint:fix", "pnpm lint:s --fix");
    },
  },
];

function eslintConfigFile(fileName: string, importName: string) {
  return async function (_: unknown, task: ListrTaskWrapper<TaskContext, YES_ANY_IS_OK_HERE, YES_ANY_IS_OK_HERE>) {

    return task.newListr([
      {
        title: `Checking if ${fileName} exists`,
        task: async (ctx, task) => {
          const lintConfigExists = getLintConfig(fileName);
          ctx.overwrite = true;
          if (lintConfigExists) {
            ctx.overwrite = await task.prompt(ListrEnquirerPromptAdapter).run({
              type: "confirm",
              name: "overwrite",
              message: `${fileName} already exists. Would you like to overwrite it?`,
            });
            if (!ctx.overwrite) {
              task.skip(`User chose not to overwrite ${fileName}. Task aborted.`);
              // throw new Error('Task aborted due to existing tsconfig.json');
            }

          }
        },
      },
      {
        title: `Setting up ${fileName}`,
        enabled: ctx => ctx.overwrite === true,
        task: async () => {

          const extendsStr = [
            `import type { Linter } from "eslint";`,
            `import defaultConfig from '@gingacodemonkey/config/${importName}';`,
            ``,
            `const config: Linter.Config[] = [...defaultConfig];`,
            ``,
            `export default config;` ].join("\n");

          fs.writeFileSync(fileName, extendsStr);
        },
      },
    ],
    { concurrent: false });
  };
}

function getLintConfig(fileName: string): boolean {
  return fs.existsSync("./"+fileName);
}
