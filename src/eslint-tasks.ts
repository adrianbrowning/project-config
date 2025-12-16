import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import fs from 'fs';
import {compareVersions, getPkgVersion, installPkg} from "./utils.ts";
import type {ListrTask} from "listr2";

const Supported_Version = "__eslint_version__";

export const esLintTasks: Array<ListrTask> = [
    {
        title: 'Checking if ESLint is installed',
        task: async (ctx, task) => {
            const eslintInstalled = getPkgVersion("@eslint/js");
            if (!eslintInstalled) {
                task.title = 'ESLint not installed. Installing...';
                installLatestESLint(ctx.packageManager);
                return;
            }

            ctx.tsVersion = eslintInstalled;
            task.title = `ESLint version ${eslintInstalled} detected`;

            if (compareVersions(eslintInstalled, Supported_Version) < 0) {
                const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
                    type: 'confirm',
                    name: 'upgrade',
                    message: `Your ESLint version is below ${Supported_Version}. Would you like to upgrade to the supported version?`,
                });
                if (upgrade) {
                    return task.newListr([{
                        title: 'Upgrading ESLint to the supported version...',
                        task: async (ctx) => {
                            installLatestESLint(ctx.packageManager);
                        }
                        }],
                        { concurrent: false });
                }
                task.skip('Skipping ESLint upgrade.');
                // throw new Error('Task aborted due to outdated ESLint version');
            }
            return;
        }
    },
    {
        title: 'eslint.config.ts',
        task: eslintConfigFile('eslint.config.ts', "eslint"),
    },
    {
        title: 'eslint.config.style.ts',
        task: eslintConfigFile('eslint.config.style.ts', "styled"),
    },
    {
        title: 'Adding lint scripts to package.json',
        task: async () => {
            const { updatePkgJsonScript } = await import('./utils.ts');
            updatePkgJsonScript('lint', 'eslint .');
            updatePkgJsonScript('lint:fix', 'eslint . --fix');
            updatePkgJsonScript('lint:style', 'eslint --config eslint.config.style.ts . --fix');
        }
    },
    ];


function eslintConfigFile(fileName: string, importName: string) {
    return async function (_: any, task: any) {

        return task.newListr([
                {
                    title: `Checking if ${fileName} exists`,
                    task: async (ctx: any, task: any) => {
                        const lintConfigExists = getLintConfig(fileName);
                        debugger;
                        ctx.overwrite = true;
                        if (lintConfigExists) {
                            ctx.overwrite = await task.prompt(ListrEnquirerPromptAdapter).run({
                                type: 'confirm',
                                name: 'overwrite',
                                message: `${fileName} already exists. Would you like to overwrite it?`,
                            });
                            if (!ctx.overwrite) {
                                task.skip(`User chose not to overwrite ${fileName}. Task aborted.`);
                                // throw new Error('Task aborted due to existing tsconfig.json');
                            }

                        }
                    }
                },
                {
                    title: `Setting up ${fileName}`,
                    enabled: (ctx: any) => ctx.overwrite === true,
                    task: async () => {

                        const extendsStr = [
                            `import type { Linter } from "eslint";`,
                            `import { config as defaultConfig } from '@gingacodemonkey/config/${importName}';`,
                            ``,
                            `const config: Linter.Config[] = [...defaultConfig];`,
                            ``,
                            `export default config;`].join("\n");


                        fs.writeFileSync(fileName, extendsStr);
                    }
                }
            ],
            {concurrent: false})
    }
}


function getLintConfig(fileName: string): boolean {
    return fs.existsSync("./"+fileName);
}



function installLatestESLint(packageManager: string): void {
    const packages = [
        `@eslint/js@${Supported_Version}`,
        'eslint',
        'typescript-eslint'
    ];
    packages.forEach(pkg => installPkg(packageManager as any, pkg));
}
