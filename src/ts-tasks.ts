import fs from "node:fs";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import { resolveTsJsx } from "./cli-args.ts";
import type { CliArgs, TaskContext } from "./cli-args.ts";
import { applySrcImports, presetMode, promptReplace, srcImportItems } from "./src-imports.ts";
import { compareVersions, getPkgVersion } from "./utils.ts";
import { packageKind } from "./workspace-exports.ts";

type PromptAnswers = {
  bundler?: boolean;
  dom?: boolean;
  jsx?: boolean;
  outDir?: string;
  runtime?: string;
  type?: string;
};

const Supported_Version = "__ts_version__";

export const tsTasks: Array<ListrTask<TaskContext>> = [
  {
    title: "Checking if TypeScript is installed",
    task: async (ctx, task) => {
      const tsVersion = isTypescriptInstalled();
      if (!tsVersion) {
        task.title = "TypeScript not installed. Installing...";
        ctx.packages.add("typescript@"+Supported_Version);
        ctx.packages.add("@types/node@^24.0.0");
        return;
      }

      ctx.tsVersion = tsVersion;
      task.title = `TypeScript version ${tsVersion} detected`;

      if (compareVersions(tsVersion, Supported_Version) < 0) {
        const upgrade = ctx.cliArgs.yes || await task.prompt(ListrEnquirerPromptAdapter).run({
          type: "confirm",
          name: "upgrade",
          message: `Your TypeScript version is below ${Supported_Version}. Would you like to upgrade to the latest?`,
        });
        if (upgrade) {
          return task.newListr([{
            title: "Upgrading TypeScript to the latest version...",
            task: async ctx => {
              ctx.packages.add("typescript@"+Supported_Version);
              ctx.packages.add("@types/node@^24.0.0");
            },
          }],
          { concurrent: false });
        }
        task.skip("Aborting task.");
        throw new Error("Task aborted due to outdated TypeScript version");
      }
      return undefined;
    },
  },
  {
    title: "tsconfig.json",
    task: async (parentCtx, task) => task.newListr([
      {
        title: "Checking if tsconfig.json exists",
        task: async (ctx, task) => {
          const tsConfigExists = getTsConfig();
          if (tsConfigExists) {
            if (parentCtx.cliArgs.yes) {
              ctx.overwrite = true;
            }
            else {
              ctx.overwrite = await task.prompt(ListrEnquirerPromptAdapter).run({
                type: "confirm",
                name: "overwrite",
                message: "tsconfig.json already exists. Would you like to overwrite it?",
              });
            }
            if (!ctx.overwrite) {
              task.skip("User chose not to overwrite tsconfig.json. Skipping task.");
              // throw new Error('Task aborted due to existing tsconfig.json');
            }
          }
          else {
            ctx.overwrite = true;
          }
        },
      },
      {
        title: "Setting up tsconfig.json",
        enabled:  ctx => ctx.overwrite === true,
        task: async (_ctx, task) => {
          // eslint-disable-next-line no-console
          console.clear();
          const { dom, bundler, type, jsx, outDir } = await task.prompt(ListrEnquirerPromptAdapter).run([
            {
              type: "select",
              name: "runtime",
              message: "What runtime is this for?",
              choices: [ "Browser", "Node.js" ],
            },
            {
              type: (_: unknown, answers: PromptAnswers) => (answers.runtime === "Browser" ? "confirm" : null),
              name: "dom",
              message: "Would you like to add DOM support?",
            },
            // {
            //   type: (_: unknown, answers: PromptAnswers) => (answers.runtime === "Browser" ? "confirm" : null),
            //   name: "bundler",
            //   message: "Are you using TSC to generate .js files?",
            //   choices: [ "Yes", "No" ],
            // },
            {
              type: "confirm", //(_: unknown, answers: PromptAnswers) => (answers.runtime === "Node.js" && !answers.bundler ? "confirm" : null),
              name: "bundler",
              message: "Are you using TSC to generate .js files?",
              choices: [ "Yes", "No" ],
            },
            {
              type: "select",
              name: "type",
              message: "Is this an App, Library, or Monorepo Library?",
              choices: [ "App", "Library", "Library-Monorepo" ],
            },
            {
              type: (_: unknown, answers: PromptAnswers) => (answers.dom ? "confirm" : null),
              name: "jsx",
              message: "Do you want to add JSX compiler option?",
            },
            {
              type: (_: unknown, answers: PromptAnswers) => (answers.bundler ? "input" : null),
              name: "outDir",
              message: "Where would you like the files to be outputted?",
              initial: "dist",
            },
          ]);

          let extendsStr = `@gingacodemonkey/config/${bundler ? "tsc" : "bundler"}/${dom ? "dom" : "no-dom"}/${type.toLowerCase()}`;

          // Determine src directory
          let srcDir = "src";
          if (!fs.existsSync(srcDir)) {
            srcDir = await task.prompt(ListrEnquirerPromptAdapter).run({
              type: "input",
              name: "srcDir",
              message: "Source directory doesn't exist. Enter the root source directory name:",
              initial: "src",
            });
            fs.mkdirSync(srcDir, { recursive: true });
          }

          writeTsConfig({ extendsStr, jsx: jsx ? "react-jsx" : undefined, outDir, srcDir, eslintConfigs: parentCtx.cliArgs.tools.includes("eslint") && !bundler });

          if (type === "App") {
            parentCtx.packages.add("@total-typescript/ts-reset@latest");
            const str = [ "import \"@total-typescript/ts-reset\";" ];
            // create reset.d.ts
            if(dom) {
              str.push("import \"@total-typescript/ts-reset/dom\";");
              str.push(`declare module 'react' {\n\t// support css variables\n\tinterface CSSProperties {\n\t\t[key: \`--\${string}\`]: string | number;\n\t}\n}`);

            }
            createTsReset(str.join("\n"), srcDir);
          }
        },
      },
    ],
    { concurrent: false }),
  },
  srcImportsTask(true),
  {
    title: "Adding TypeScript scripts to package.json",
    task: async () => {
      const { updatePkgJsonScript } = await import("./utils.ts");
      updatePkgJsonScript("lint:ts", "tsc --noEmit");
    },
  },
];

/**
 * The `#src/*.ts` import in package.json, matching the tsconfig on disk (just written, or the one the user kept).
 * Interactive setup asks before replacing a mapping of the user's; `--yes` keeps it and says so.
 */
function srcImportsTask(interactive: boolean): ListrTask<TaskContext> {
  return {
    title: "Adding the #src package import",
    task: async (ctx, task) => {
      const items = srcImportItems(".", presetMode("tsconfig.json"), packageKind(".", "tsconfig.json") === "library", ctx.cliArgs.tsOutdir);
      const notes = await applySrcImports(items, interactive ? promptReplace(task) : null);
      if (notes.length > 0) task.title = `#src package import: ${notes.join("; ")}`;
    },
  };
}

function isTypescriptInstalled(): string | undefined {
  return getPkgVersion("typescript") ?? undefined;
}

function getTsConfig(): boolean {
  return fs.existsSync("tsconfig.json");
}

type TsConfigOptions = {
  /** Type-check the root ESLint configs too: bundler mode only, since tsc mode's rootDir is the source directory */
  eslintConfigs: boolean;
  extendsStr: string;
  jsx: string | undefined;
  outDir: string | undefined;
  srcDir: string;
};

/**
 * tsc mode emits the source directory straight into outDir (rootDir src), where the compiled #src imports point, so
 * the root ESLint configs stay out of it; ESLint loads them itself.
 */
function writeTsConfig({ eslintConfigs, extendsStr, jsx, outDir, srcDir }: TsConfigOptions): void {
  const tsConfig = {
    "extends": extendsStr,
    compilerOptions: {
      ...(jsx ? { jsx } : {}),
      ...(outDir ? { outDir, rootDir: eslintConfigs ? "." : `./${srcDir}` } : {}),
    },
    // Every .ts and .tsx file at any depth (tsconfig globs have no brace expansion)
    include: [ ...(eslintConfigs ? [ "eslint.config.ts", "eslint.config.style.ts" ] : []), `./${srcDir}/**/*.ts`, `./${srcDir}/**/*.tsx` ],
    exclude: [ "node_modules", ...(outDir ? [ outDir ] : []) ],
  };
  fs.writeFileSync("tsconfig.json", JSON.stringify(tsConfig, null, 2));
}

function createTsReset(config: string, srcDir = "src"): void {
  fs.writeFileSync(`${srcDir}/reset.d.ts`, config);
}

/**
 * Create TS tasks for non-interactive mode using CLI args
 */
export function createTsTasksWithArgs(cliArgs: CliArgs): Array<ListrTask<TaskContext>> {
  return [
    {
      title: "Checking if TypeScript is installed",
      task: async (ctx: TaskContext, task) => {
        const tsVersion = isTypescriptInstalled();
        if (!tsVersion) {
          task.title = "TypeScript not installed. Installing...";
          ctx.packages.add("typescript@"+Supported_Version);
          ctx.packages.add("@types/node@^24.0.0");
          return;
        }

        ctx.tsVersion = tsVersion;
        task.title = `TypeScript version ${tsVersion} detected`;

        if (compareVersions(tsVersion, Supported_Version) < 0) {
          // In non-interactive mode, auto-upgrade
          task.title = `Upgrading TypeScript from ${tsVersion} to ${Supported_Version}...`;
          ctx.packages.add("typescript@"+Supported_Version);
          ctx.packages.add("@types/node@^24.0.0");
        }
      },
    },
    {
      title: "Setting up tsconfig.json",
      task: async (ctx: TaskContext) => {
        const dom = cliArgs.tsDom;
        const bundler = cliArgs.tsMode === "tsc"; // bundler: false means using external bundler
        const type = cliArgs.tsType;
        const jsx = resolveTsJsx(cliArgs);
        const outDir = cliArgs.tsOutdir;

        // Map type to config path format
        const typeStr = type === "library-monorepo" ? "library-monorepo" : type;
        const extendsStr = `@gingacodemonkey/config/${bundler ? "tsc" : "bundler"}/${dom ? "dom" : "no-dom"}/${typeStr}`;

        writeTsConfig({ extendsStr, jsx: jsx ?? undefined, outDir, srcDir: "src", eslintConfigs: cliArgs.tools.includes("eslint") && !bundler });

        if (type === "app") {
          ctx.packages.add("@total-typescript/ts-reset@^0.6.1");
          const str = [ "import \"@total-typescript/ts-reset\";" ];
          if (dom) {
            str.push("import \"@total-typescript/ts-reset/dom\";");
            str.push(`declare module 'react' {\n\t// support css variables\n\tinterface CSSProperties {\n\t\t[key: \`--\${string}\`]: string | number;\n\t}\n}`);
          }
          // Ensure src directory exists
          if (!fs.existsSync("src")) {
            fs.mkdirSync("src", { recursive: true });
          }
          createTsReset(str.join("\n"));
        }

        // Add type: module to package.json if flag is set
        if (cliArgs.tsTypeModule) {
          const { updatePkgJson } = await import("./utils.ts");
          updatePkgJson("type", "module");
        }
      },
    },
    srcImportsTask(false),
    {
      title: "Adding TypeScript scripts to package.json",
      task: async () => {
        const { updatePkgJsonScript } = await import("./utils.ts");
        updatePkgJsonScript("lint:ts", "tsc --noEmit");
      },
    },
  ];
}
