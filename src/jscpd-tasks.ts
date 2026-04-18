import type { ListrTask } from "listr2";
import type { TaskContext } from "./cli-args.ts";
import { writeConfigFile } from "./utils.ts";

const Supported_Version = "__jscpd_version__";
const pkgName = "jscpd";

const configFile = {
  path: ".jscpd.json",
  content: {
    "minTokens": 50,
    "format": [ "typescript", "javascript" ],
    "ignore": [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.test.js",
      "**/*.test.jsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.spec.js",
      "**/*.spec.jsx",
      "**/__tests__/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
    ],
    "reporters": [ "console" ],
  },
};

export const jscpdTasks: Array<ListrTask<TaskContext>> = [
  {
    title: "Checking if jscpd is installed",
    task: async (ctx, task) => {
      const { getPkgVersion } = await import("./utils.ts");
      const installed = getPkgVersion(pkgName);
      if (!installed) {
        task.title = "jscpd not installed. Queuing install...";
        ctx.packages.add(`${pkgName}@${Supported_Version}`);
        return;
      }
      task.title = `jscpd version ${installed} detected`;
    },
  },
  {
    title: `Adding ${configFile.path}`,
    task: writeConfigFile(configFile.path, JSON.stringify(configFile.content, null, 2)),
  },
  {
    title: "Adding jscpd script to package.json",
    task: async () => {
      const { updatePkgJsonScript } = await import("./utils.ts");
      updatePkgJsonScript("lint:jscpd", "jscpd .");
    },
  },
];
