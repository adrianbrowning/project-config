import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
// import type {ListrTask} from "listr2";

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

let pj: PackageJson | null = null;

export function getPackageJson(): PackageJson {
  if (pj) return pj;
  if (!fs.existsSync("package.json")) throw new Error("No package.json found");
  pj = (JSON.parse(fs.readFileSync("package.json", "utf8")) as PackageJson | null);
  if(!pj) throw new Error("No package.json found");
  return pj;
}

export function getPkgVersion(pkg: string): string | null {
  debugger;
  const pj = getPackageJson();
  let version = "";
  if (pj.dependencies && pj.dependencies[pkg]) {
    version = pj.dependencies[pkg];
  }
  else if (pj.devDependencies && pj.devDependencies[pkg]) {
    version = pj.devDependencies[pkg];
  }
  if (!version) return null;
  return version.replace(/^[~^]/, "").trim();
}

export function has(pkg: string): boolean {
  try {
    import.meta.resolve(pkg, import.meta.url);
    return true;
  }
  catch {
    return false;
  }
}

export async function detectPackageManager(task: any, nonInteractive = false): Promise<"npm" | "yarn" | "pnpm" | "bun"> {
  if (fs.existsSync("package-lock.json")) return "npm";
  if (fs.existsSync("yarn.lock")) return "yarn";
  if (fs.existsSync("pnpm-lock.yaml")) return "pnpm";
  if (fs.existsSync("bun.lockb")) return "bun";

  // In non-interactive mode, default to pnpm
  if (nonInteractive) {
    return "pnpm";
  }

  const { packageManager } = await task.prompt(ListrEnquirerPromptAdapter).run({
    type: "select",
    name: "packageManager",
    message: "No lock file found. Please select your package manager:",
    choices: [ "npm", "yarn", "pnpm", "bun" ],
  });

  return packageManager;
}

export function installPkg(packageManager: "npm" | "yarn" | "pnpm" | "bun", pkg: string): void {
  const installCommand = {
    npm: `npm install ${pkg} --save-dev`,
    yarn: `yarn add ${pkg} --dev`,
    pnpm: `pnpm add ${pkg} --save-dev`,
    bun: `bun add ${pkg} --dev`,
  }[packageManager];

  execSync(installCommand, { stdio: "inherit" });
}

export function compareVersions(v1: string, v2: string): -1 | 0 | 1 {
  const splitV1 = v1.split(".").map(Number);
  const splitV2 = v2.split(".").map(Number);

  for (let i = 0; i < Math.max(splitV1.length, splitV2.length); i++) {
    const partV1 = splitV1[i] || 0;
    const partV2 = splitV2[i] || 0;

    if (partV1 > partV2) return 1;
    if (partV1 < partV2) return -1;
  }
  return 0;
}

export function writeConfigFile(fileName: string, content: string) {
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
        enabled: (ctx: any) => ctx.overwrite === true,
        task: async () => {
          const dir = path.dirname(fileName); // Get the directory path
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true }); // Ensure the directory and parents exist
          }
          fs.writeFileSync(fileName, content);
        },
      },
    ],
    { concurrent: false });
  };
}

function getLintConfig(fileName: string): boolean {
  return fs.existsSync("./" + fileName);
}

export function updatePkgJsonScript(name: string, value: string): void {
  const pkgJ = getPackageJson();
  pkgJ.scripts = pkgJ.scripts || {};
  pkgJ.scripts[name] = value;
  fs.writeFileSync("package.json", JSON.stringify(pkgJ, null, 2));
}

export function updatePkgJson(key: string, value: unknown): void {
  const pkgJ = getPackageJson() as Record<string, unknown>;
  // Merge objects if both are objects
  if (typeof value === "object" && value !== null && !Array.isArray(value) &&
        typeof pkgJ[key] === "object" && pkgJ[key] !== null && !Array.isArray(pkgJ[key])) {
    pkgJ[key] = { ...(pkgJ[key]), ...(value) };
  }
  else {
    pkgJ[key] = value;
  }
  fs.writeFileSync("package.json", JSON.stringify(pkgJ, null, 2));
}
