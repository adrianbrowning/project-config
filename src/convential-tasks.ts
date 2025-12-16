import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import {compareVersions, getPkgVersion, writeConfigFile} from "./utils.ts";
import type {ListrTask} from "listr2";

let Supported_Version = "";
let pkgName = "";


export const commitLintTasks: Array<ListrTask> = [
    {
        title: 'Checking if CommitLint is installed',
        task: async (ctx: any, task: any) => {
            pkgName = "@commitlint/cli";
            Supported_Version = "__commitlint_version__";
            const eslintInstalled = getPkgVersion(pkgName);
            if (!eslintInstalled) {
                task.title = 'CommitLint not installed. Installing...';
                ctx.packages.add(`${pkgName}@${Supported_Version}`);
                return;
            }

            ctx.tsVersion = eslintInstalled;
            task.title = `CommitLint version ${eslintInstalled} detected`;

            if (compareVersions(eslintInstalled, Supported_Version) < 0) {
                const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
                    type: 'confirm',
                    name: 'upgrade',
                    message: `Your CommitLint version is below ${Supported_Version}. Would you like to upgrade to the supported version?`,
                });
                if (upgrade) {
                    return task.newListr([{
                        title: 'Upgrading CommitLint to the supported version...',
                        task: async (ctx: any) => {
                            ctx.packages.add(`${pkgName}@${Supported_Version}`);
                        }
                        }],
                        { concurrent: false });
                }
                task.skip('Skipping CommitLint upgrade.');
                // throw new Error('Task aborted due to outdated CommitLint version');
            }

        }
    },
    {
        title: 'Checking if @commitlint/config-conventional is installed',
        task: async (ctx: any, task: any) => {
            pkgName = "@commitlint/config-conventional";
            Supported_Version = "__commitlint_version__";
            const eslintInstalled = getPkgVersion(pkgName);
            if (!eslintInstalled) {
                task.title = 'CommitLint/config-conventional not installed. Installing...';
                ctx.packages.add(`${pkgName}@${Supported_Version}`);
                return;
            }

            ctx.tsVersion = eslintInstalled;
            task.title = `CommitLint/config-conventional version ${eslintInstalled} detected`;

            if (compareVersions(eslintInstalled, Supported_Version) < 0) {
                const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
                    type: 'confirm',
                    name: 'upgrade',
                    message: `Your CommitLint/config-conventional version is below ${Supported_Version}. Would you like to upgrade to the supported version?`,
                });
                if (upgrade) {
                    return task.newListr([{
                        title: 'Upgrading CommitLint/config-conventional to the supported version...',
                        task: async (ctx: any) => {
                            ctx.packages.add(`${pkgName}@${Supported_Version}`);
                        }
                        }],
                        { concurrent: false });
                }
                task.skip('Skipping CommitLint upgrade.');
                // throw new Error('Task aborted due to outdated CommitLint version');
            }

        }
    },
    {
        title: "Setting up CommitLint Config",
        task: writeConfigFile("commitlint.config.js", `export default {
  "extends": [ "@commitlint/config-conventional" ],
  "rules": {
    "subject-case": [ 2, "always", [ "sentence-case", "lower-case" ]],
  },
};`)
    }
    ];
