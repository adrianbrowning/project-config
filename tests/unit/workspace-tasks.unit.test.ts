/**
 * Workspace setup: the update-all offer for an existing workspace
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Listr } from "listr2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPackageCollector, parseCliArgs } from "../../src/cli-args.ts";
import type { TaskContext } from "../../src/cli-args.ts";
import { createWorkspaceTasks } from "../../src/workspace-tasks.ts";
import type { ConfirmUpdateAll } from "../../src/workspace-tasks.ts";

const PACKAGE_FILES = {
  "packages/a/package.json": "{ \"name\": \"a\", \"scripts\": { \"build\": \"echo build\" } }\n",
  "packages/a/tsconfig.json": "{ \"include\": [\"src\"] }\n",
  "packages/b/package.json": "{ \"name\": \"b\" }\n",
};

let dir: string;
let originalCwd: string;

function read(file: string): string | undefined {
  return fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), "utf8") : undefined;
}

async function runWorkspaceSetup(confirmUpdateAll: ConfirmUpdateAll, extraArgs: Array<string> = []): Promise<void> {
  const cliArgs = parseCliArgs([ "--tool=workspace", ...extraArgs ]);
  const ctx: TaskContext = { cliArgs, packageManager: "pnpm", packages: createPackageCollector() };
  await new Listr(createWorkspaceTasks(cliArgs, confirmUpdateAll), { ctx, renderer: "silent" }).run();
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-unit-workspace-"));
  fs.writeFileSync(path.join(dir, "package.json"), "{ \"name\": \"root\", \"private\": true }\n");
  fs.writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
  for (const [ file, content ] of Object.entries(PACKAGE_FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("existing workspace update-all offer", () => {
  it("asks once with every discovered package, and declining leaves them untouched", async () => {
    const asked: Array<Array<string>> = [];
    await runWorkspaceSetup(async (_task, packages) => {
      asked.push(packages);
      return false;
    });

    expect(asked).toEqual([[ "packages/a", "packages/b" ]]);
    for (const [ file, content ] of Object.entries(PACKAGE_FILES)) expect(read(file)).toBe(content);
    expect(read("packages/a/eslint.config.ts")).toBeUndefined();
    expect(read("sharedConfig/tsconfig.base.json")).toBeDefined();
  });

  it("accepting links every discovered package", async () => {
    await runWorkspaceSetup(async () => true);

    for (const pkg of [ "packages/a", "packages/b" ]) {
      expect(read(`${pkg}/eslint.config.ts`)).toBe("import config from \"../../sharedConfig/eslint.config.ts\";\n\nexport default config;\n");
    }
    expect(JSON.parse(read("packages/a/package.json")!)).toMatchObject({ scripts: { "build": "echo build", "lint:ts": "tsc --noEmit" } });
  });
});

describe("shared tsconfig base jsx", () => {
  const base = "sharedConfig/tsconfig.base.json";
  const compilerOptions = () => (JSON.parse(read(base)!) as { compilerOptions?: Record<string, unknown>; }).compilerOptions;
  const writeBase = (options: Record<string, unknown>) => {
    fs.mkdirSync(path.join(dir, "sharedConfig"), { recursive: true });
    fs.writeFileSync(path.join(dir, base), JSON.stringify({ extends: "@gingacodemonkey/config/bundler/dom/app", compilerOptions: options }));
  };

  it.each([
    [ "a new DOM app base gets react-jsx", [], undefined, { jsx: "react-jsx" }],
    [ "a new no-dom base gets no jsx", [ "--ts-no-dom" ], undefined, undefined ],
    [ "a new library base gets no jsx", [ "--ts-type=library" ], undefined, undefined ],
    [ "an existing jsx is kept without --ts-jsx, in place", [], { jsx: "preserve", strict: true }, { jsx: "preserve", strict: true }],
    [ "--ts-jsx replaces an existing jsx", [ "--ts-jsx=react" ], { jsx: "preserve", strict: true }, { jsx: "react", strict: true }],
    [ "--ts-jsx=none removes an existing jsx", [ "--ts-jsx=none" ], { jsx: "preserve", strict: true }, { strict: true }],
  ] as const)("%s", async (_title, args, existing, expected) => {
    if (existing) writeBase(existing);
    await runWorkspaceSetup(async () => false, [ ...args ]);
    // Stringified, so an existing jsx must also keep its position among the user's options
    expect(JSON.stringify(compilerOptions())).toBe(JSON.stringify(expected));
  });
});
