/**
 * pnpm workspace boundaries: the shared ESLint config rejects imports into another package's private files
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

const RULE = "gingacodemonkey/workspace-boundaries";
const PROBE = "apps/web/src/probe.ts";

/** A library with public exports and a consumer app under a second, custom glob, linked as pnpm would link them */
function writeWorkspace(project: TestProject): void {
  project.writeFile("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  project.writeJson("packages/lib/package.json", {
    name: "@scope/lib",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts", "./utils": "./src/utils.ts" },
    // The mapping setup generates in bundler mode (#31), so setup and --update leave it alone
    imports: { "#src/*.ts": "./src/*.ts" },
  });
  project.writeFile("packages/lib/src/index.ts", "import { twice } from \"#src/utils.ts\";\n\nexport function quad(n: number): number {\n  return twice(twice(n));\n}\n");
  project.writeFile("packages/lib/src/utils.ts", "export function twice(n: number): number {\n  return n * 2;\n}\n");
  project.writeFile("packages/lib/src/internal.ts", "export const secret = 1;\n");
  project.writeJson("apps/web/package.json", {
    name: "@scope/web",
    private: true,
    type: "module",
    dependencies: { "@scope/lib": "workspace:*" },
    imports: { "#src/*.ts": "./src/*.ts" },
  });
  project.writeFile("apps/web/src/local.ts", "export const local = 1;\n");
  project.writeFile("apps/web/src/main.ts", [
    "import { quad } from \"@scope/lib\";",
    "import { twice } from \"@scope/lib/utils\";",
    "import { local } from \"#src/local.ts\";",
    "",
    "export const value = quad(local) + twice(local);",
    "",
  ].join("\n"));
  fs.mkdirSync(path.join(project.dir, "apps/web/node_modules/@scope"), { recursive: true });
  fs.symlinkSync(path.join(project.dir, "packages/lib"), path.join(project.dir, "apps/web/node_modules/@scope/lib"), "dir");
}

/** `pnpm -r lint` with `code` added to the consumer app; the probe file is removed even when an assertion fails. */
function lintWith(project: TestProject, code: string): { exitCode: null | number; output: string; } {
  project.writeFile(PROBE, code);
  try {
    const result = runCommand(project, "pnpm --recursive lint", { expectFailure: true });
    return { exitCode: result.exitCode, output: result.stdout + result.stderr };
  }
  finally {
    fs.rmSync(path.join(project.dir, PROBE), { force: true });
  }
}

describe("workspace package boundaries", () => {
  it("lints public exports and own #src imports clean, and fails private and cross-package imports", () => {
    using project = new TestProject({ name: "workspace-boundaries" });
    writeWorkspace(project);
    project.runCli([ "--tool=workspace", "--yes", "--workspace-update-all", "--ts-no-dom", "--ts-type=library" ]);

    expect(project.readFile("sharedConfig/eslint.config.ts")).toContain("...defaultConfig,");
    const clean = runCommand(project, "pnpm --recursive lint", { expectFailure: true });
    expect(clean.stdout + clean.stderr).not.toContain(RULE);
    expect(clean.exitCode).toBe(0);

    const privatePath = lintWith(project, "import { secret } from \"@scope/lib/src/internal\";\n\nexport const probe = secret;\n");
    expect(privatePath.output).toContain(RULE);
    expect(privatePath.output).toContain("`@scope/lib/src/internal` is not a public export of @scope/lib");
    expect(privatePath.exitCode).not.toBe(0);

    const relative = lintWith(project, "import { secret } from \"../../../packages/lib/src/internal.ts\";\n\nexport const probe = secret;\n");
    expect(relative.output).toContain("`../../../packages/lib/src/internal.ts` reaches into @scope/lib's files");
    expect(relative.exitCode).not.toBe(0);
  });

  it("honours an allow list in the shared config's extraRules, and --update keeps it", () => {
    using project = new TestProject({ name: "workspace-boundaries-allow" });
    writeWorkspace(project);
    project.runCli([ "--tool=workspace", "--yes", "--workspace-update-all", "--ts-no-dom", "--ts-type=library" ]);
    const generated = project.readFile("sharedConfig/eslint.config.ts");
    const customised = generated.replace(
      "export const extraRules: Array<Linter.Config> = [];",
      `export const extraRules: Array<Linter.Config> = [\n  { rules: { "${RULE}": [ "error", { allow: [ "@scope/lib/src/internal.ts" ] } ] } },\n];`
    );
    expect(customised).not.toBe(generated);
    project.writeFile("sharedConfig/eslint.config.ts", customised);

    project.exec("pnpm exec gingacodemonkey-config --update --yes");
    expect(project.readFile("sharedConfig/eslint.config.ts")).toBe(customised);

    // The allow list matches what the import reaches, so the relative spelling is let through too. The bare one is
    // a side-effect import: TypeScript can't resolve a path outside `exports`, and a typed value would trip other rules
    expect(lintWith(project, "import { secret } from \"../../../packages/lib/src/internal.ts\";\n\nexport const probe = secret;\n").exitCode).toBe(0);
    expect(lintWith(project, "import \"@scope/lib/src/internal.ts\";\n").exitCode).toBe(0);
    expect(lintWith(project, "import { twice } from \"@scope/lib/src/utils.ts\";\n\nexport const probe = twice(1);\n").output).toContain(RULE);
  });
});
