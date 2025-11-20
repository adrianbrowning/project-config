import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import {execSync} from 'child_process';
import fs from 'fs';
import {installPkg, compareVersions} from "./utils.js";

const Supported_Version = "__ts_version__";

export const tsTasks = [
    {
        title: 'Checking if TypeScript is installed',
        task: async (ctx, task) => {
            const tsVersion = isTypescriptInstalled();
            if (!tsVersion) {
                task.title = 'TypeScript not installed. Installing...';
                installPkg(ctx.packageManager, "typescript@latest");
                return;
            }

            ctx.tsVersion = tsVersion;
            task.title = `TypeScript version ${tsVersion} detected`;

            if (compareVersions(tsVersion, Supported_Version) < 0) {
                const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
                    type: 'confirm',
                    name: 'upgrade',
                    message: `Your TypeScript version is below ${Supported_Version}. Would you like to upgrade to the latest?`,
                });
                if (upgrade) {
                    return task.newListr([{
                        title: 'Upgrading TypeScript to the latest version...',
                        task: async (ctx, task) => {
                            installLatestTypescript(ctx.packageManager);
                        }
                        }],
                        { concurrent: false });
                }
                task.skip('Aborting task.');
                throw new Error('Task aborted due to outdated TypeScript version');
            }

        }
    },
    {
        title: 'tsconfig.json',
        task: async (ctx, task) => {

            return task.newListr([
                {
                    title: 'Checking if tsconfig.json exists',
                    task: async (ctx, task) => {
                        const tsConfigExists = getTsConfig();
                        debugger;
                        if (tsConfigExists) {
                            ctx.overwrite = await  task.prompt(ListrEnquirerPromptAdapter).run({
                                type: 'confirm',
                                name: 'overwrite',
                                message: 'tsconfig.json already exists. Would you like to overwrite it?',
                            });
                            if (!ctx.overwrite) {
                                task.skip('User chose not to overwrite tsconfig.json. Skipping task.');
                                // throw new Error('Task aborted due to existing tsconfig.json');
                            }

                        }
                    }
                },
                    {
                        title: 'Setting up tsconfig.json',
                        enabled:  (ctx) => ctx.overwrite === true,
                        task: async (ctx, task) => {
                            console.clear();
                            const {runtime, dom, bundler, type, jsx, outDir} = await task.prompt(ListrEnquirerPromptAdapter).run([
                                {
                                    type: 'select',
                                    name: 'runtime',
                                    message: 'What runtime is this for?',
                                    choices: ['Browser', 'Node.js']
                                },
                                {
                                    type: (_, answers) => {
                                        return (answers.runtime === 'Browser' ? 'confirm' : null);
                                    },
                                    name: 'dom',
                                    message: 'Would you like to add DOM support?',
                                },
                                {
                                    type: (_, answers) => {
                                        return (answers.runtime === 'Browser' ? 'confirm' : null);
                                    },
                                    name: 'bundler',
                                    message: 'Are you using TSC to generate .js files?',
                                    choices: ['Yes', 'No']
                                },
                                {
                                    type: (_, answers) => {
                                        return (answers.runtime === 'Node.js' && !answers.bundler ? 'confirm' : null);
                                    },
                                    name: 'bundler',
                                    message: 'Are you using TSC to generate .js files?',
                                    choices: ['Yes', 'No']
                                },
                                {
                                    type: 'select',
                                    name: 'type',
                                    message: 'Is this an App, Library, or Monorepo Library?',
                                    choices: ['App', 'Library', 'Library-Monorepo']
                                },
                                {
                                    type: (_, answers) => {
                                        return (answers.dom ? 'confirm' : null);
                                    },
                                    name: 'jsx',
                                    message: 'Do you want to add JSX compiler option?',
                                },
                                {
                                    type: (_, answers) => {
                                        return (answers.bundler ? 'input' : null);
                                    },
                                    name: "outDir",
                                    message: "Where would you like the files to be outputted?",
                                    initial: "dist"
                                }
                            ]);

                            let extendsStr;
                            if (runtime === 'Node.js') {
                                extendsStr = `@gingacodemonkey/config/tsc/node/${type.toLowerCase()}`;
                            } else {
                                extendsStr = `@gingacodemonkey/config/${bundler ? "tsc" : "bundler"}/${dom ? "dom" : "no-dom"}/${type.toLowerCase()}`;
                            }


                            // Create tsconfig based on user input
                            const tsConfig = {
                                "extends": extendsStr,
                                compilerOptions: {
                                    ...(jsx ? {jsx:'react'} : {}),
                                    ...(outDir ? {outDir} : {}),
                                },
                                include: ['./src/**.ts'],
                                exclude: ['node_modules', ...(outDir ? [outDir] : [])]
                            };

                            createTsConfig(tsConfig);

                            if (type === "App") {
                                const str = ["import '@total-typescript/ts-reset';"];
                                // create reset.d.ts
                                // add
                                if(dom) {
                                    str.push("import '@total-typescript/ts-reset/dom';");
                                    str.push(`declare module 'react' {\n\t// support css variables\n\tinterface CSSProperties {\n\t\t[key: \`--${string}\`]: string | number;\n\t}\n}`);

                                }
                                createTsReset(str.join('\n'));
                            }
                        }
                    }
            ],
                { concurrent: false })
        }
    },
];

// Helper function declarations
function isTypescriptInstalled() {
    try {
        const version = execSync('npx tsc --version').toString().trim().split(' ')[1];
        return version;
    } catch {
        return false;
    }
}

function installLatestTypescript(packageManager) {
    installPkg(packageManager, "typescript@"+Supported_Version);
}



function getTsConfig() {
    return fs.existsSync('tsconfig.json');
}

function createTsConfig(config) {
    fs.writeFileSync('tsconfig.json', JSON.stringify(config, null, 2));
}

function createTsReset(config) {
    fs.writeFileSync('reset.d.ts', config);
}
