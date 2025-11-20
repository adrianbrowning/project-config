import {execSync} from "child_process";
import fs from "node:fs";
import path from "node:path";
import {ListrEnquirerPromptAdapter} from "@listr2/prompt-adapter-enquirer";

let pj = null;

export function getPackageJson() {
    if (pj) return pj;
    if (!fs.existsSync('package.json')) throw new Error("No package.json found");
    pj = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    return pj;
}

export function getPkgVersion(pkg) {
    debugger;
    const pj = getPackageJson();
    let version = "";
    if (pj.dependencies && pj.dependencies[pkg]) {
        version = pj.dependencies[pkg];
    } else if (pj.devDependencies && pj.devDependencies[pkg]) {
        version = pj.devDependencies[pkg];
    }
    if (!version) return null;
    return version.replace(/^[^~]/, "").trim();
}

export function has(pkg) {
    try {
        import.meta.resolve(pkg, import.meta.url)
        return true
    } catch {
        return false
    }
}

export async function detectPackageManager(task) {
    if (fs.existsSync('package-lock.json')) return 'npm';
    if (fs.existsSync('yarn.lock')) return 'yarn';
    if (fs.existsSync('pnpm-lock.yaml')) return 'pnpm';
    if (fs.existsSync('bun.lockb')) return 'bun';

    const {packageManager} = await task.prompt(ListrEnquirerPromptAdapter).run({
        type: 'select',
        name: 'packageManager',
        message: 'No lock file found. Please select your package manager:',
        choices: ['npm', 'yarn', 'pnpm', 'bun'],
    });

    return packageManager;
}

export function installPkg(packageManager, pkg) {
    const installCommand = {
        npm: `npm install ${pkg} --save-dev`,
        yarn: `yarn add ${pkg} --dev`,
        pnpm: `pnpm add ${pkg} --save-dev`,
        bun: `bun add ${pkg} --dev`,
    }[packageManager];

    execSync(installCommand, {stdio: 'inherit'});
}


export function compareVersions(v1, v2) {
    const splitV1 = v1.split('.').map(Number);
    const splitV2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(splitV1.length, splitV2.length); i++) {
        const partV1 = splitV1[i] || 0;
        const partV2 = splitV2[i] || 0;

        if (partV1 > partV2) return 1;
        if (partV1 < partV2) return -1;
    }
    return 0;
}

export function writeConfigFile(fileName, content) {
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
                        const dir = path.dirname(fileName); // Get the directory path
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir, {recursive: true}); // Ensure the directory and parents exist
                        }
                        fs.writeFileSync(fileName, content);
                    }
                }
            ],
            {concurrent: false})
    }
}

function getLintConfig(fileName) {
    return fs.existsSync("./" + fileName);
}

export function updatePkgJsonScript(name, value) {
    const pkgJ = getPackageJson();
    pkgJ.scripts = pkgJ.scripts || {}
    pkgJ.scripts[name] = value;
}
