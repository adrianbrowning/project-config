/**
 * The #src/*.ts package import setup generates by default (#31): bundler mode reads source, tsc mode runs the compiled
 * output and tests from source, other aliases and the user's own #src mappings are kept, workspace packages at any
 * depth map to their own src/, and rerunning setup or update changes nothing.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

type Manifest = Record<string, unknown> & { imports?: Record<string, unknown>; scripts?: Record<string, string>; };

const KEY = "#src/*.ts";
const SOURCE_TEST = "node --conditions=gingacodemonkey:source --test";
const TS_SETUP = [ "--tool=ts", "--yes", "--ts-no-dom", "--ts-type=library" ];

/** Two modules, one importing the other through the alias. */
function seedModules(project: TestProject, dir: string, name: string): void {
  project.writeFile(`${dir}/src/util/name.ts`, `export function name(): string {\n  return "${name}";\n}\n`);
  project.writeFile(`${dir}/src/index.ts`, "import { name } from \"#src/util/name.ts\";\n\nexport const label: string = `label:${name()}`;\n");
}

/** A node:test test importing a module through the alias; it needs Node's types to type-check. */
function seedTest(project: TestProject, dir: string, name: string): void {
  project.writeFile(`${dir}/src/index.test.ts`, [
    "import assert from \"node:assert/strict\";",
    "import { test } from \"node:test\";",
    "import { name } from \"#src/util/name.ts\";",
    "",
    `await test("name", () => {\n  assert.equal(name(), "${name}");\n});`,
    "",
  ].join("\n"));
}

function seedSource(project: TestProject, dir = ".", name = "lib"): void {
  seedModules(project, dir, name);
  seedTest(project, dir, name);
}

/** A Node command that imports `file` (a path from the project root) and prints one of its exports. */
function printExport(file: string, name: string): string {
  return `node --input-type=module -e "const m = await import('${file}'); console.log(m.${name});"`;
}

/** Runs `run` with `<dir>/src` moved away, so nothing can load TypeScript source from it. */
function withoutSource<T>(project: TestProject, dir: string, run: () => T): T {
  const src = path.join(project.dir, dir, "src");
  fs.renameSync(src, `${src}.hidden`);
  try {
    return run();
  }
  finally {
    fs.renameSync(`${src}.hidden`, src);
  }
}

/** A deliberate type error through the alias must fail the type-check, so the alias carries real types. */
function expectAliasTypeError(project: TestProject, file: string, command = "pnpm lint:ts"): void {
  project.writeFile(file, "import { name } from \"#src/util/name.ts\";\n\nexport const n: number = name();\n");
  try {
    const result = runCommand(project, command, { expectFailure: true });
    expect(result.exitCode, result.stdout).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/TS2322/);
  }
  finally {
    fs.rmSync(path.join(project.dir, file), { force: true });
  }
}

/** Every file outside node_modules/.git, build output and caches, so two runs can be compared */
function snapshot(project: TestProject, dir = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(project.dir, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (![ "node_modules", ".git", "dist", "build" ].includes(entry.name)) Object.assign(files, snapshot(project, rel));
    }
    else if (entry.name !== ".eslintcache" && entry.name !== "pnpm-lock.yaml") files[rel] = project.readFile(rel);
  }
  return files;
}

function update(project: TestProject, ...flags: Array<string>) {
  const result = runCommand(project, `pnpm exec gingacodemonkey-config --update ${flags.join(" ")}`, { expectFailure: true });
  return { ...result, output: stripVTControlCharacters(result.stdout + result.stderr) };
}

/** Every path an imports target can resolve to, across its conditions. */
function targets(value: unknown): Array<string> {
  if (typeof value === "string") return [ value ];
  return value !== null && typeof value === "object" ? Object.values(value).flatMap(targets) : [];
}

describe("#src package imports", () => {
  it("bundler mode: maps #src to source, which type-checks and runs under Node", () => {
    using project = new TestProject({ name: "src-imports-bundler" });
    seedModules(project, ".", "lib");
    project.runCli(TS_SETUP);

    expect(project.readJson<Manifest>("package.json").imports).toEqual({ [KEY]: "./src/*.ts" });
    expect(project.readJson("tsconfig.json")).toMatchObject({ extends: "@gingacodemonkey/config/bundler/no-dom/library" });

    expect(runCommand(project, "pnpm lint:ts", { expectFailure: true }).exitCode).toBe(0);
    expectAliasTypeError(project, "src/probe.ts");
    // What a bundler reads: the source, through the alias; Node's type stripping stands in for it
    expect(runCommand(project, printExport("./src/index.ts", "label")).stdout).toBe("label:lib\n");
    // The bundler presets load no @types, so the node:test test joins only after the type-check
    seedTest(project, ".", "lib");
    expect(runCommand(project, "node --test").stdout).toMatch(/pass 1/);
  });

  it("tsc mode: the emitted JavaScript resolves #src to the output, and tests run from source without a build", () => {
    using project = new TestProject({ name: "src-imports-tsc" });
    seedSource(project);
    project.runCli([ ...TS_SETUP, "--ts-mode=tsc" ]);

    // The template project is private, so it's an application: tests get the source condition
    expect(project.readJson<Manifest>("package.json").imports).toEqual({
      [KEY]: { "types": "./dist/*.d.ts", "gingacodemonkey:source": "./src/*.ts", "default": "./dist/*.js" },
    });
    expect(project.readJson("tsconfig.json")).toMatchObject({ compilerOptions: { outDir: "dist", rootDir: "./src" } });
    expect(runCommand(project, "pnpm lint:ts", { expectFailure: true }).exitCode).toBe(0);
    expectAliasTypeError(project, "src/probe.ts");

    // Before any build: the condition sends #src to src/; without it Node looks for dist/ and fails
    expect(project.fileExists("dist")).toBe(false);
    expect(runCommand(project, SOURCE_TEST).stdout).toMatch(/pass 1/);
    expect(runCommand(project, "node --test", { expectFailure: true }).exitCode).not.toBe(0);

    runCommand(project, "pnpm exec tsc");
    expect(project.readFile("dist/index.js")).toContain("\"#src/util/name.ts\"");
    expect(withoutSource(project, ".", () => runCommand(project, printExport("./dist/index.js", "label")).stdout)).toBe("label:lib\n");
  });

  it("keeps other aliases and a conflicting #src mapping in setup, and update replaces it only with --overwrite", () => {
    using project = new TestProject({ name: "src-imports-conflict" });
    const imports = { "#config": "./config.json", [KEY]: "./source/*.ts" };
    project.writeJson("package.json", { ...project.readJson<Manifest>("package.json"), imports });

    const output = stripVTControlCharacters(project.runCli(TS_SETUP));
    expect(output).toContain(`kept your own package.json › imports["${KEY}"] (is "./source/*.ts", expected "./src/*.ts")`);
    expect(project.readJson<Manifest>("package.json").imports).toEqual(imports);

    const refused = update(project, "--tool=ts", "--yes");
    expect(refused.exitCode).toBe(1);
    expect(refused.output).toMatch(/conflict\s+package\.json › imports\["#src\/\*\.ts"\] \(is "\.\/source\/\*\.ts", expected "\.\/src\/\*\.ts"\)/);
    expect(project.readJson<Manifest>("package.json").imports).toEqual(imports);

    expect(update(project, "--tool=ts", "--yes", "--overwrite").exitCode).toBe(0);
    expect(project.readJson<Manifest>("package.json").imports).toEqual({ "#config": "./config.json", [KEY]: "./src/*.ts" });
    expect(update(project, "--tool=ts", "--yes").output).toContain("Nothing to update.");
  });

  it("update adds the mapping to a project set up before it existed, then changes nothing", () => {
    using project = new TestProject({ name: "src-imports-update" });
    project.runCli([ ...TS_SETUP, "--ts-mode=tsc" ]);
    const manifest = project.readJson<Manifest>("package.json");
    const generated = manifest.imports;
    expect(generated).toHaveProperty([ KEY ]);
    delete manifest.imports;
    project.writeJson("package.json", { ...manifest, imports: { "#config": "./config.json" } });

    const first = update(project, "--tool=ts", "--yes");
    expect(first.exitCode, first.output).toBe(0);
    expect(first.output).toMatch(/added\s+package\.json › imports\["#src\/\*\.ts"\]/);
    expect(project.readJson<Manifest>("package.json").imports).toEqual({ "#config": "./config.json", ...generated });

    const second = update(project, "--tool=ts", "--yes");
    expect(second.output).toContain("Nothing to update.");
  });

  it("workspace: each package at any depth maps #src to its own src/, builds, runs, packs and reruns cleanly", () => {
    using project = new TestProject({ name: "src-imports-workspace" });
    project.writeFile("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - 'apps/*/*'\n");
    project.writeJson("packages/lib/package.json", { name: "@scope/lib", version: "1.0.0", type: "module" });
    seedSource(project, "packages/lib", "lib");
    // A private app three levels down, with its own outDir and an override setup must keep
    const site = "apps/web/site";
    project.writeJson(`${site}/package.json`, {
      name: "@scope/site",
      version: "1.0.0",
      private: true,
      type: "module",
      dependencies: { "@scope/lib": "workspace:^" },
      imports: { "#config": "./config.json" },
      scripts: { test: SOURCE_TEST },
    });
    project.writeJson(`${site}/tsconfig.json`, { compilerOptions: { outDir: "build", noUnusedLocals: false }, include: [ "src" ] });
    seedSource(project, site, "site");
    project.writeFile(`${site}/src/main.ts`, "import { label } from \"@scope/lib\";\nimport { name } from \"#src/util/name.ts\";\n\nexport const summary = `${name()}+${label}`;\n");

    const setup = [ "--tool=workspace", "--yes", "--workspace-update-all", "--ts-mode=tsc", "--ts-no-dom", "--ts-type=library" ];
    project.runCli(setup);
    project.install();

    expect(project.readJson<Manifest>("packages/lib/package.json").imports).toEqual({ [KEY]: { types: "./dist/*.d.ts", default: "./dist/*.js" } });
    expect(project.readJson<Manifest>(`${site}/package.json`).imports).toEqual({
      "#config": "./config.json",
      [KEY]: { "types": "./build/*.d.ts", "gingacodemonkey:source": "./src/*.ts", "default": "./build/*.js" },
    });
    expect(project.readJson(`${site}/tsconfig.json`)).toMatchObject({ compilerOptions: { outDir: "build", noUnusedLocals: false, rootDir: "src" } });

    const rerun = snapshot(project);
    project.runCli(setup);
    expect(snapshot(project)).toEqual(rerun);

    // Before any build, the app's test imports its own src/util/name.ts through the source condition. The library
    // has none (its tarball holds no src/), so its test needs the build, as the readme says
    expect(runCommand(project, `cd ${site} && ${SOURCE_TEST}`).stdout).toMatch(/pass 1/);
    expect(runCommand(project, `cd packages/lib && ${SOURCE_TEST}`, { expectFailure: true }).exitCode).not.toBe(0);
    expect(runCommand(project, "cd packages/lib && pnpm exec tsc --build && node --test \"src/**/*.test.ts\"").stdout).toMatch(/pass 1/);

    const check = runCommand(project, "pnpm lint:ts", { expectFailure: true });
    expect(check.exitCode, check.stdout + check.stderr).toBe(0);
    const lint = runCommand(project, "pnpm --recursive lint", { expectFailure: true });
    expect(lint.exitCode, lint.stdout + lint.stderr).toBe(0);
    expectAliasTypeError(project, `${site}/src/probe.ts`);

    // Built output, with neither package's source on disk
    const output = withoutSource(project, site, () => withoutSource(project, "packages/lib", () => runCommand(project, printExport(`./${site}/build/main.js`, "summary")).stdout));
    expect(output).toBe("site+label:lib\n");

    // The published library declares no imports target its tarball lacks
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-src-imports-pack-"));
    try {
      project.exec(`cd packages/lib && pnpm pack --pack-destination ${packDir}`);
      const tarball = path.join(packDir, fs.readdirSync(packDir).find(file => file.endsWith(".tgz"))!);
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- tar from PATH, like git and pnpm in the test utils
      const files = execFileSync("tar", [ "-tzf", tarball ], { encoding: "utf8" }).split("\n")
        .filter(Boolean)
        .map(file => file.replace(/^package\//, ""));
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- as above
      const packed = JSON.parse(execFileSync("tar", [ "-xzOf", tarball, "package/package.json" ], { encoding: "utf8" })) as Manifest;
      const mapped = targets(packed.imports?.[KEY]);
      expect(mapped.length).toBeGreaterThan(0);
      for (const module of [ "index", "util/name" ]) {
        for (const target of mapped) expect(files, target).toContain(target.replace(/^\.\//, "").replace("*", module));
      }
    }
    finally {
      fs.rmSync(packDir, { recursive: true, force: true });
    }

    // --update restores a mapping a package lost, and a second run has nothing to do for it
    const manifest = project.readJson<Manifest>(`${site}/package.json`);
    project.writeJson(`${site}/package.json`, { ...manifest, imports: { "#config": "./config.json" } });
    const restored = update(project, "--tool=workspace", "--yes");
    expect(restored.exitCode, restored.output).toBe(0);
    expect(restored.output).toMatch(/added\s+apps\/web\/site\/package\.json › imports\["#src\/\*\.ts"\]/);
    expect(project.readJson<Manifest>(`${site}/package.json`).imports).toEqual(manifest.imports);
    expect(update(project, "--tool=workspace", "--yes").output).not.toMatch(/(?:added|updated|conflict)\s+\S+ › imports/);
  });
});
