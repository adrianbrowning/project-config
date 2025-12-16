import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import { compareVersions, getPkgVersion, writeConfigFile } from "./utils.ts";

const Supported_Version = "__knip_version__";
const pkgName = "knip";

const configFile = {
  path: "knip.json",
  content: {
    "entry": [
      "src/**/*.{js,ts}",
    ],
    "project": [
      "**/*.{js,ts}",
    ],
    "ignoreBinaries": [],
    "ignoreDependencies": [],
  },
};

export const knipTasks: Array<ListrTask> = [
  {
    title: "Checking if Knip is installed",
    task: async (ctx: any, task: any) => {
      const knipInstalled = getPkgVersion(pkgName);
      if (!knipInstalled) {
        task.title = "Knip not installed. Installing...";
        ctx.packages.add(`${pkgName}@${Supported_Version}`);
        return;
      }

      ctx.tsVersion = knipInstalled;
      task.title = `Knip version ${knipInstalled} detected`;

      if (compareVersions(knipInstalled, Supported_Version) < 0) {
        const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
          type: "confirm",
          name: "upgrade",
          message: `Your Knip version is below ${Supported_Version}. Would you like to upgrade to the supported version?`,
        });
        if (upgrade) {
          return task.newListr([{
            title: "Upgrading Knip to the supported version...",
            task: async (ctx: any) => {
              ctx.packages.add(`${pkgName}@${Supported_Version}`);
            },
          }],
          { concurrent: false });
        }
        task.skip("Skipping Knip upgrade.");
        // throw new Error('Task aborted due to outdated Knip version');
      }

    },
  },
  {
    title: `Adding ${configFile.path} file`,
    task: writeConfigFile(configFile.path, JSON.stringify(configFile.content, null, 2)),
  },
  {
    title: "Adding knip script to package.json",
    task: async () => {
      const { updatePkgJsonScript } = await import("./utils.ts");
      updatePkgJsonScript("knip", "knip");
    },
  },
];
