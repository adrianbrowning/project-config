/**
 * Project references in a pnpm workspace: `tsc --build` from the root builds each dependency before its consumer,
 * and setup and --update keep the references in step with the declared dependencies
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

type Tsconfig = { compilerOptions?: Record<string, unknown>; files?: Array<string>; references?: Array<{ path: string; }>; };

const SITE = "apps/web/site";

/** A library and an app one level deeper that depends on it; the app relies on its own compiler override */
function seedLibAndApp(project: TestProject): void {
  project.writeFile(".gitignore", "node_modules\n");
  project.writeFile("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - 'apps/*/*'\n");
  project.writeJson("packages/lib/package.json", { name: "@demo/lib", private: true, type: "module", exports: { ".": "./src/index.ts" } });
  project.writeFile("packages/lib/src/index.ts", "export function double(value: number): number {\n  return value * 2;\n}\n");
  project.writeJson(`${SITE}/package.json`, { name: "site", private: true, type: "module", dependencies: { "@demo/lib": "workspace:*" } });
  project.writeJson(`${SITE}/tsconfig.json`, { compilerOptions: { noUnusedParameters: false }, include: [ "src" ] });
  // `unused` only type-checks while the package's own noUnusedParameters: false survives
  project.writeFile(`${SITE}/src/index.ts`, "import { double } from \"@demo/lib\";\n\nexport function quadruple(value: number, unused: string): number {\n  return double(double(value));\n}\n");
}

function update(project: TestProject) {
  const result = runCommand(project, "pnpm exec gingacodemonkey-config --update --tool=workspace --yes", { expectFailure: true });
  return { ...result, output: result.stdout + result.stderr };
}

/** Files git would pick up, so a build that writes anywhere not ignored shows up as a difference */
function untracked(project: TestProject): string {
  return project.exec("git status --porcelain --untracked-files=all");
}

/** The order `tsc --build --verbose` built the projects in, as package directories */
function buildOrder(output: string, project: TestProject): Array<string> {
  return [ ...output.matchAll(/Building project '([^']+)'/g) ].map(match => path.relative(fs.realpathSync(project.dir), path.dirname(String(match[1]))));
}

describe("workspace project references (bundler preset)", () => {
  let project: TestProject;

  beforeAll(() => {
    project = new TestProject({ name: "workspace-references" });
    seedLibAndApp(project);
    project.runCli([ "--tool=workspace", "--yes", "--workspace-update-all", "--ts-no-dom" ]);
    if (!project.fileExists(`${SITE}/node_modules/@demo/lib`)) project.exec("pnpm install --offline");
  });

  afterAll(() => project.cleanup());

  it("writes a root solution and references the library from the app, keeping the app's override", () => {
    expect(project.readJson<Tsconfig>("tsconfig.json")).toEqual({ files: [], references: [{ path: SITE }, { path: "packages/lib" }] });
    const site = project.readJson<Tsconfig>(`${SITE}/tsconfig.json`);
    expect(site.references).toEqual([{ path: "../../../packages/lib" }]);
    expect(site.compilerOptions).toMatchObject({ noUnusedParameters: false, composite: true, outDir: "dist", emitDeclarationOnly: true });
    expect(project.readFile(".gitignore")).toBe("node_modules\n\n# TypeScript build output (tsc --build)\ndist/\n");
  });

  it("`tsc --build` from the root builds the library before the app, writing only ignored files", () => {
    const before = untracked(project);
    const build = runCommand(project, "pnpm exec tsc --build --verbose", { expectFailure: true });
    expect(build.exitCode, build.stdout + build.stderr).toBe(0);
    expect(buildOrder(build.stdout, project)).toEqual([ "packages/lib", SITE ]);

    for (const file of [ "packages/lib/dist/src/index.d.ts", "packages/lib/dist/.tsbuildinfo", `${SITE}/dist/src/index.d.ts`, `${SITE}/dist/.tsbuildinfo` ]) {
      expect(project.fileExists(file), file).toBe(true);
    }
    expect(untracked(project)).toBe(before);

    // Incremental: nothing changed, so nothing is rebuilt
    expect(buildOrder(runCommand(project, "pnpm exec tsc --build --verbose").stdout, project)).toEqual([]);
  });

  it("the root lint:ts type-checks every package through its references", () => {
    project.rmDir("packages/lib/dist");
    project.rmDir(`${SITE}/dist`);
    const lint = runCommand(project, "pnpm lint:ts", { expectFailure: true });
    expect(lint.exitCode, lint.stdout + lint.stderr).toBe(0);
  });

  it("--update drops the reference when the dependency goes and adds it back once when it returns", () => {
    const manifest = project.readJson<Record<string, unknown>>(`${SITE}/package.json`);
    const withoutLib = { ...manifest };
    delete withoutLib.dependencies;
    project.writeJson(`${SITE}/package.json`, withoutLib);
    const removed = update(project);
    expect(removed.exitCode, removed.output).toBe(0);
    expect(removed.output).toContain(`updated    ${SITE}/tsconfig.json › project references`);
    expect(project.readJson<Tsconfig>(`${SITE}/tsconfig.json`).references).toBeUndefined();
    expect(project.readJson<Tsconfig>(`${SITE}/tsconfig.json`).compilerOptions?.noUnusedParameters).toBe(false);

    project.writeJson(`${SITE}/package.json`, { ...withoutLib, devDependencies: { "@demo/lib": "workspace:^" } });
    expect(update(project).exitCode).toBe(0);
    expect(project.readJson<Tsconfig>(`${SITE}/tsconfig.json`).references).toEqual([{ path: "../../../packages/lib" }]);

    const again = update(project);
    expect(again.exitCode, again.output).toBe(0);
    expect(again.output).toContain("Nothing to update.");
    expect(project.readJson<Tsconfig>(`${SITE}/tsconfig.json`).references).toHaveLength(1);
    expect(project.readJson<Tsconfig>("tsconfig.json").references).toHaveLength(2);
  });

  it("a dependency cycle fails setup and --update, naming both packages, and writes nothing", () => {
    const lib = project.readJson<Record<string, unknown>>("packages/lib/package.json");
    project.writeJson("packages/lib/package.json", { ...lib, devDependencies: { site: "workspace:*" } });
    const before = [ "tsconfig.json", "packages/lib/tsconfig.json", `${SITE}/tsconfig.json` ].map(file => project.readFile(file));
    const cycle = "Dependency cycle between @demo/lib (packages/lib), site (apps/web/site)";

    const updated = update(project);
    expect(updated.exitCode).not.toBe(0);
    expect(updated.output).toContain(cycle);

    const setup = runCommand(project, "pnpm exec gingacodemonkey-config --tool=workspace --yes --workspace-update-all", { expectFailure: true });
    expect(setup.exitCode).not.toBe(0);
    expect(setup.stdout + setup.stderr).toContain(cycle);
    expect([ "tsconfig.json", "packages/lib/tsconfig.json", `${SITE}/tsconfig.json` ].map(file => project.readFile(file))).toEqual(before);
  });
});

describe("workspace project references (tsc preset)", () => {
  it("emits JavaScript for every package, the library first", () => {
    using project = new TestProject({ name: "workspace-references-tsc" });
    seedLibAndApp(project);
    project.runCli([ "--tool=workspace", "--yes", "--workspace-update-all", "--ts-no-dom", "--ts-mode=tsc" ]);
    if (!project.fileExists(`${SITE}/node_modules/@demo/lib`)) project.exec("pnpm install --offline");

    const before = untracked(project);
    const build = runCommand(project, "pnpm exec tsc --build --verbose", { expectFailure: true });
    expect(build.exitCode, build.stdout + build.stderr).toBe(0);
    expect(buildOrder(build.stdout, project)).toEqual([ "packages/lib", SITE ]);
    expect(project.readFile(`${SITE}/dist/src/index.js`)).toContain("from \"@demo/lib\"");
    expect(project.fileExists("packages/lib/dist/src/index.js")).toBe(true);
    expect(untracked(project)).toBe(before);
  });
});
