import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import {compareVersions, getPkgVersion, has, installPkg} from "./utils.ts";
import type {ListrTask} from "listr2";

const Supported_Version = "__husky_version__";

const commitMsg = `pnpm exec commitlint --edit "$1";
FILE=$1
MESSAGE=$(cat $FILE)
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
        title: 'Checking if Husky is installed',
        task: async (ctx: any, task: any) => {
            const eslintInstalled = getPkgVersion("husky");
            if (!eslintInstalled) {
                task.title = 'Husky not installed. Installing...';
                installLatestHusky(ctx.packageManager);
                return;
            }

            ctx.tsVersion = eslintInstalled;
            task.title = `Husky version ${eslintInstalled} detected`;

            if (compareVersions(eslintInstalled, Supported_Version) < 0) {
                const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
                    type: 'confirm',
                    name: 'upgrade',
                    message: `Your Husky version is below ${Supported_Version}. Would you like to upgrade to the supported version?`,
                });
                if (upgrade) {
                    return task.newListr([{
                        title: 'Upgrading Husky to the supported version...',
                        task: async (ctx: any, task: any) => {
                            installLatestHusky(ctx.packageManager);
                        }
                        }],
                        { concurrent: false });
                }
                task.skip('Skipping Husky upgrade.');
                // throw new Error('Task aborted due to outdated Husky version');
            }

        }
    },
    {
        title: 'Check if Husky is configured',
        task: async function (ctx: any, task: any) {
            const taskList: Array<any> = [{
                title: "Husky init",
                task: async (ctx: any, task: any) => {
                    execSync(`pnpm exec husky init`);
                }
            }];
            if (!fs.existsSync(".husky/pre-commit")) {
                taskList.push({
                    title: "Adding Pre-Commit Hook",
                    task: async (ctx: any, task: any) => {
                        fs.writeFileSync(".husky/pre-commit", "pnpm exec lint-staged");
                    }
                })
            }
            if (!fs.existsSync(".husky/commit-msg")) {
                taskList.push({
                        title: "Adding Commit-Msg Hook",
                        task: async (ctx: any, task: any) => {
                            fs.writeFileSync(".husky/commit-msg", commitMsg);
                        }
                    }
                )
            }
            return task.newListr(taskList);
        },
    }
    ];



function installLatestHusky(packageManager: string): void {
    installPkg(packageManager as any, `husky@${Supported_Version}`);
}
