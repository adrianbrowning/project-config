import { execSync } from "node:child_process";
import fs from "node:fs";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import type { CliArgs, TaskContext } from "./cli-args.ts";
import { compareVersions } from "./utils.ts";

type TsConfigObject = {
  extends: string;
  compilerOptions: {
    jsx?: string;
    outDir?: string;
  };
  include: Array<string>;
  exclude: Array<string>;
};

type PromptAnswers = {
  runtime?: string;
  dom?: boolean;
  bundler?: boolean;
  type?: string;
  jsx?: boolean;
  outDir?: string;
};

const Supported_Version = "__ts_version__";

export const tsTasks: Array<ListrTask<TaskContext>> = [
  {
    title: "Checking if TypeScript is installed",
    task: async (ctx, task) => {
      const tsVersion = isTypescriptInstalled();
      if (!tsVersion) {
        task.title = "TypeScript not installed. Installing...";
        ctx.packages.add("typescript@latest");
        ctx.packages.add("@types/node@^24.0.0");
        return;
      }

      ctx.tsVersion = tsVersion;
      task.title = `TypeScript version ${tsVersion} detected`;

      if (compareVersions(tsVersion, Supported_Version) < 0) {
        const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
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
    task: async (_ctx, task) => task.newListr([
      {
        title: "Checking if tsconfig.json exists",
        task: async (ctx, task) => {
          const tsConfigExists = getTsConfig();
          if (tsConfigExists) {
            ctx.overwrite = await task.prompt(ListrEnquirerPromptAdapter).run({
              type: "confirm",
              name: "overwrite",
              message: "tsconfig.json already exists. Would you like to overwrite it?",
            });
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
          console.clear();
          const { dom, bundler, type, jsx, outDir } = await task.prompt(ListrEnquirerPromptAdapter).run([
            // {
            //     type: 'select',
            //     name: 'runtime',
            //     message: 'What runtime is this for?',
            //     choices: ['Browser', 'Node.js']
            // },
            {
              type: (_: unknown, answers: PromptAnswers) => (answers.runtime === "Browser" ? "confirm" : null),
              name: "dom",
              message: "Would you like to add DOM support?",
            },
            {
              type: (_: unknown, answers: PromptAnswers) => (answers.runtime === "Browser" ? "confirm" : null),
              name: "bundler",
              message: "Are you using TSC to generate .js files?",
              choices: [ "Yes", "No" ],
            },
            {
              type: (_: unknown, answers: PromptAnswers) => (answers.runtime === "Node.js" && !answers.bundler ? "confirm" : null),
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

          // Create tsconfig based on user input
          const tsConfig = {
            "extends": extendsStr,
            compilerOptions: {
              ...(jsx ? { jsx:"react" } : {}),
              ...(outDir ? { outDir } : {}),
            },
            include: [ "./src/**.ts" ],
            exclude: [ "node_modules", ...(outDir ? [ outDir ] : []) ],
          };

          createTsConfig(tsConfig);

          if (type === "App") {
            const str = [ "import \"@total-typescript/ts-reset\";" ];
            // create reset.d.ts
            // add
            if(dom) {
              str.push("import \"@total-typescript/ts-reset/dom\";");
              str.push(`declare module 'react' {\n\t// support css variables\n\tinterface CSSProperties {\n\t\t[key: \`--\${string}\`]: string | number;\n\t}\n}`);

            }
            createTsReset(str.join("\n"));
          }
        },
      },
    ],
    { concurrent: false }),
  },
  {
    title: "Adding TypeScript scripts to package.json",
    task: async () => {
      const { updatePkgJsonScript } = await import("./utils.ts");
      updatePkgJsonScript("lint:ts", "tsc --noEmit");
    },
  },
];

// Helper function declarations
function isTypescriptInstalled(): string | undefined {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Using package manager command to check installed TypeScript version in the project
    const version = execSync("pnpm list typescript | grep typescript").toString()
      .trim()
      .split(" ")[1];
    if (!version) return undefined;
    return version;
  }
  catch {
    return undefined;
  }
}

function getTsConfig(): boolean {
  return fs.existsSync("tsconfig.json");
}

function createTsConfig(config: TsConfigObject): void {
  fs.writeFileSync("tsconfig.json", JSON.stringify(config, null, 2));
}

function createTsReset(config: string): void {
  fs.writeFileSync("src/reset.d.ts", config);
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
          ctx.packages.add("typescript@latest");
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
      task: async () => {
        const dom = cliArgs.tsDom;
        const bundler = cliArgs.tsMode === "tsc"; // bundler: false means using external bundler
        const type = cliArgs.tsType;
        const jsx = cliArgs.tsJsx;
        const outDir = cliArgs.tsOutdir;

        // Map type to config path format
        const typeStr = type === "library-monorepo" ? "library-monorepo" : type;
        const extendsStr = `@gingacodemonkey/config/${bundler ? "tsc" : "bundler"}/${dom ? "dom" : "no-dom"}/${typeStr}`;

        // Create tsconfig based on CLI args
        const tsConfig = {
          "extends": extendsStr,
          compilerOptions: {
            ...(jsx ? { jsx } : {}),
            ...(outDir ? { outDir } : {}),
          },
          include: [ "./src/**.ts" ],
          exclude: [ "node_modules", ...(outDir ? [ outDir ] : []) ],
        };

        createTsConfig(tsConfig);

        if (type === "app") {
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
      },
    },
    {
      title: "Adding TypeScript scripts to package.json",
      task: async () => {
        const { updatePkgJsonScript } = await import("./utils.ts");
        updatePkgJsonScript("lint:ts", "tsc --noEmit");
      },
    },
  ];
}
