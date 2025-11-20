import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import {execSync} from 'child_process';
import fs from 'fs';
import {compareVersions, getPkgVersion, has, installPkg} from "./utils.js";

const Supported_Version = "__eslint_version__";

export const esLintTasks = [
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
                        task: async (ctx, task) => {
                            installLatestESLint(ctx.packageManager);
                        }
                        }],
                        { concurrent: false });
                }
                task.skip('Skipping ESLint upgrade.');
                // throw new Error('Task aborted due to outdated ESLint version');
            }

        }
    },
    {
        title: 'eslint.config.js',
        task: eslintConfigFile('eslint.config.js', "eslint"),
    },
    {
        title: 'eslint.config.style.js',
        task: eslintConfigFile('eslint.config.style.js', "styled"),
    },
    ];


function eslintConfigFile(fileName, importName) {
    return async function (ctx, task) {

        return task.newListr([
                {
                    title: `Checking if ${fileName} exists`,
                    task: async (ctx, task) => {
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
                    enabled: (ctx) => ctx.overwrite === true,
                    task: async (ctx, task) => {

                        const extendsStr = [
                            `import { config as defaultConfig } from '@gingacodemonkey/config/${importName}'`,
                            `/** @type {import("eslint").Linter.Config} */`,
                            `export default [...defaultConfig]`].join("\n");


                        fs.writeFileSync(fileName, extendsStr);
                    }
                }
            ],
            {concurrent: false})
    }
}

// Helper function declarations
function isESlintInstalled() {
    try {

        const version = execSync('npx tsc --version').toString().trim().split(' ')[1];
        return version;
    } catch {
        return false;
    }
}


function getLintConfig(fileName) {
    return fs.existsSync("./"+fileName);
}



function installLatestESLint(packageManager) {
    installPkg(packageManager, `@eslint/js@${Supported_Version}`);
}
