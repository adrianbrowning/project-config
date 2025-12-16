import { execSync } from "node:child_process";
import fs from "node:fs";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import { compareVersions, getPkgVersion } from "./utils.ts";

const Supported_Version = "__husky_version__";

const commitMsg = `#!/bin/sh
# Skip hook for semantic-release commits
MESSAGE=$(cat "$1")
if echo "$MESSAGE" | grep -q "\\[skip ci\\]"; then
  exit 0
fi

pnpm exec commitlint --edit "$1";
FILE=$1
TICKET=[$(git rev-parse --abbrev-ref HEAD | grep -Eo '^(\\w+/)?(\\w+[-_])?[0-9]+' | grep -Eo '(\\w+[-])?[0-9]+' | tr "[:lower:]" "[:upper:]")]
if [[ $TICKET == "[]" || "$MESSAGE" == "$TICKET"* ]];then
  exit 0;
fi
# Strip leading '['
TICKET="\${TICKET#\[}"
# Strip trailing ']'
TICKET="\${TICKET %\]}"
echo $"$TICKET\\n\\n$MESSAGE" > $FILE`;

export const huskyTasks: Array<ListrTask> = [
  {
    title: "Checking if Husky is installed",
    task: async (ctx: any, task: any) => {
      const eslintInstalled = getPkgVersion("husky");
      if (!eslintInstalled) {
        task.title = "Husky not installed. Installing...";
        ctx.packages.add(`husky@${Supported_Version}`);
        return;
      }

      ctx.tsVersion = eslintInstalled;
      task.title = `Husky version ${eslintInstalled} detected`;

      if (compareVersions(eslintInstalled, Supported_Version) < 0) {
        const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
          type: "confirm",
          name: "upgrade",
          message: `Your Husky version is below ${Supported_Version}. Would you like to upgrade to the supported version?`,
        });
        if (upgrade) {
          return task.newListr([{
            title: "Upgrading Husky to the supported version...",
            task: async (ctx: any) => {
              ctx.packages.add(`husky@${Supported_Version}`);
            },
          }],
          { concurrent: false });
        }
        task.skip("Skipping Husky upgrade.");
        // throw new Error('Task aborted due to outdated Husky version');
      }

    },
  },
  {
    title: "Check if Husky is configured",
    task: async function (_: any, task: any) {
      const taskList: Array<any> = [{
        title: "Husky init",
        task: async () => {
          execSync(`pnpm exec husky init`);
        },
      }];
      if (!fs.existsSync(".husky/pre-commit")) {
        taskList.push({
          title: "Adding Pre-Commit Hook",
          task: async () => {
            fs.writeFileSync(".husky/pre-commit", "pnpm exec lint-staged");
          },
        });
      }
      if (!fs.existsSync(".husky/commit-msg")) {
        taskList.push({
          title: "Adding Commit-Msg Hook",
          task: async () => {
            fs.writeFileSync(".husky/commit-msg", commitMsg);
          },
        }
        );
      }
      if (!fs.existsSync(".husky/pre-push")) {
        taskList.push({
          title: "Adding Pre-Push Hook",
          task: async () => {
            fs.writeFileSync(".husky/pre-push", "#!/bin/sh\npnpm lint");
          },
        }
        );
      }
      return task.newListr(taskList);
    },
  },
];
