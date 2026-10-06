/**
 * Library packages in a pnpm workspace get publish-safe entry points: exports, main, types, type and files pointing
 * at tsc's output, a build script, and the tsconfig options that make tsc emit there.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

type Manifest = Record<string, unknown> & { exports?: Record<string, unknown>; scripts?: Record<string, string>; };

const LIB = "packages/lib";
const LIB_MANIFEST = `${LIB}/package.json`;
const SETUP = [ "--tool=workspace", "--yes", "--workspace-update-all", "--ts-no-dom", "--ts-type=library" ];

/** A public library (with a configured subpath and a custom one) and a private app, as an existing workspace. */
function seedWorkspace(project: TestProject): void {
  project.writeFile("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  project.writeJson(LIB_MANIFEST, {
    name: "@demo/lib",
    version: "1.0.0",
    exports: { "./package.json": "./package.json" },
    gingacodemonkey: { subpathExports: { "./format": "./src/utils/format.ts" } },
  });
  project.writeFile(`${LIB}/src/index.ts`, "export { shout } from \"./utils/format.ts\";\n\nexport function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n");
  project.writeFile(`${LIB}/src/utils/format.ts`, "export function shout(text: string): string {\n  return text.toUpperCase();\n}\n");
  project.writeFile(`${LIB}/src/index.test.ts`, "import { greet } from \"./index.ts\";\n\ngreet(\"test\");\n");
  project.writeJson("apps/web/package.json", { name: "web", version: "1.0.0", private: true, type: "module" });
  project.writeFile("apps/web/src/index.ts", "export const app = true;\n");
}

/** Every string an exports map can resolve to, `types` conditions included. */
function exportTargets(value: unknown): Array<string> {
  if (typeof value === "string") return [ value ];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
}

function packLibrary(project: TestProject, destination: string): { files: Array<string>; tarball: string; } {
  project.exec(`cd ${LIB} && pnpm pack --pack-destination ${destination}`);
  const tarball = path.join(destination, fs.readdirSync(destination).find(file => file.endsWith(".tgz"))!);
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- tar from PATH, like git and pnpm in the test utils
  const files = execFileSync("tar", [ "-tzf", tarball ], { encoding: "utf8" }).split("\n")
    .filter(Boolean)
    .map(file => file.replace(/^package\//, ""));
  return { files, tarball };
}

function update(project: TestProject, ...flags: Array<string>) {
  const result = runCommand(project, `pnpm exec gingacodemonkey-config --update --tool=workspace ${flags.join(" ")}`, { expectFailure: true });
  return { ...result, output: stripVTControlCharacters(result.stdout + result.stderr) };
}

describe("workspace library exports", () => {
  it("tsc mode: a library builds and packs every manifest path, and a clean consumer installs, type-checks and runs it", () => {
    using project = new TestProject({ name: "workspace-exports-tsc" });
    seedWorkspace(project);
    project.runCli([ ...SETUP, "--ts-mode=tsc" ]);

    const lib = project.readJson<Manifest>(LIB_MANIFEST);
    expect(lib).toMatchObject({
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      files: [ "dist", "!dist/**/*.test.*", "!dist/**/*.spec.*", "!dist/.tsbuildinfo" ],
      scripts: { build: "tsc" },
    });
    expect(lib.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./package.json": "./package.json",
      "./format": { types: "./dist/utils/format.d.ts", default: "./dist/utils/format.js" },
    });
    expect(project.readJson(`${LIB}/tsconfig.json`)).toMatchObject({ compilerOptions: { outDir: "dist", rootDir: "src", tsBuildInfoFile: "dist/.tsbuildinfo" } });
    // The private app is an application: no publishing fields, no build script
    const app = project.readJson<Manifest>("apps/web/package.json");
    for (const field of [ "exports", "main", "types", "files" ]) expect(app).not.toHaveProperty(field);
    expect(app.scripts).not.toHaveProperty("build");

    project.exec("pnpm build");
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-exports-pack-"));
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-exports-consumer-"));
    try {
      const { files, tarball } = packLibrary(project, packDir);
      const targets = [ lib.main, lib.types, ...exportTargets(lib.exports) ].map(target => String(target).replace(/^\.\//, ""));
      for (const target of targets) expect(files, target).toContain(target);
      for (const target of targets) expect(target).not.toMatch(/(?<!\.d)\.ts$/);
      expect(files).toEqual(expect.arrayContaining([ "dist/index.js", "dist/index.d.ts", "dist/utils/format.js", "dist/utils/format.d.ts" ]));
      expect(files.filter(file => /^(?:src\/|.*(?:tsconfig|eslint\.config|\.test\.|tsbuildinfo))/.test(file))).toEqual([]);

      // A project outside the workspace: only the tarball, no workspace links or source to fall back on
      fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
      fs.writeFileSync(path.join(consumer, "tsconfig.json"), JSON.stringify({
        compilerOptions: { module: "nodenext", strict: true, noEmit: true, lib: [ "esnext", "dom" ], types: [], skipLibCheck: false },
      }));
      fs.writeFileSync(path.join(consumer, "index.ts"), [
        "import { greet } from \"@demo/lib\";",
        "import { shout } from \"@demo/lib/format\";",
        "",
        "const message: string = shout(greet(\"consumer\"));",
        "console.log(message);",
        "",
      ].join("\n"));
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- pnpm from PATH, like the test utils
      execFileSync("pnpm", [ "add", tarball ], { cwd: consumer, stdio: "pipe" });
      execFileSync(path.join(project.dir, "node_modules/.bin/tsc"), [ "-p", consumer ], { stdio: "pipe" });
      expect(execFileSync(process.execPath, [ "index.ts" ], { cwd: consumer, encoding: "utf8" })).toBe("HELLO, CONSUMER!\n");
    }
    finally {
      fs.rmSync(packDir, { recursive: true, force: true });
      fs.rmSync(consumer, { recursive: true, force: true });
    }
  });

  it("keeps custom exports and the user's values through setup and update, reporting conflicts", () => {
    using project = new TestProject({ name: "workspace-exports-custom" });
    seedWorkspace(project);
    project.runCli([ ...SETUP, "--ts-mode=tsc" ]);

    // The user's own subpaths, one of them pointing at TypeScript source, and an own build script
    const manifest = project.readJson<Manifest>(LIB_MANIFEST);
    const exportsMap = { ...manifest.exports, "./extra": { types: "./dist/utils/format.d.ts", default: "./dist/utils/format.js" }, "./raw": "./src/utils/format.ts" };
    const withoutMain: Manifest = { ...manifest, exports: exportsMap, scripts: { ...manifest.scripts, build: "tsc -p tsconfig.json" } };
    delete withoutMain.main;
    project.writeJson(LIB_MANIFEST, withoutMain);

    const rerun = stripVTControlCharacters(project.runCli([ ...SETUP, "--ts-mode=tsc" ]));
    expect(rerun).toContain("kept your own package.json › scripts.build");
    expect(rerun).toContain("customized package.json › exports[\"./raw\"] (resolves to ./src/utils/format.ts");
    const afterSetup = project.readJson<Manifest>(LIB_MANIFEST);
    expect(afterSetup.exports).toEqual(exportsMap);
    expect(afterSetup).toMatchObject({ main: "./dist/index.js", scripts: { build: "tsc -p tsconfig.json" } });

    // Update keeps the subpaths too; a changed managed value is a conflict: nothing is written without --overwrite
    project.writeJson(LIB_MANIFEST, { ...afterSetup, types: "./types/index.d.ts" });
    const blocked = update(project, "--yes");
    expect(blocked.exitCode).toBe(1);
    expect(blocked.output).toMatch(/conflict\s+packages\/lib\/package\.json › types \(is "\.\/types\/index\.d\.ts", expected "\.\/dist\/index\.d\.ts"\)/);
    expect(project.readJson<Manifest>(LIB_MANIFEST).types).toBe("./types/index.d.ts");

    const overwritten = update(project, "--yes", "--overwrite");
    expect(overwritten.exitCode, overwritten.output).toBe(0);
    const afterUpdate = project.readJson<Manifest>(LIB_MANIFEST);
    expect(afterUpdate).toMatchObject({ types: "./dist/index.d.ts", scripts: { build: "tsc" } });
    expect(afterUpdate.exports).toEqual(exportsMap);

    const second = update(project, "--yes");
    expect(second.exitCode, second.output).toBe(0);
    expect(second.output).not.toMatch(/(?:added|updated|conflict)\s+packages\/lib\//);
    expect(project.readJson<Manifest>(LIB_MANIFEST)).toEqual(afterUpdate);
  });

  it("bundler mode: setup fails with an explanation instead of publishing a library without build output", () => {
    using project = new TestProject({ name: "workspace-exports-bundler" });
    seedWorkspace(project);

    const result = runCommand(project, `pnpm exec gingacodemonkey-config ${SETUP.join(" ")} --ts-mode=bundler`, { expectFailure: true });

    expect(result.exitCode).not.toBe(0);
    const output = stripVTControlCharacters(result.stdout + result.stderr);
    expect(output).toContain("Library packages packages/lib can't be published from a bundler-mode workspace");
    expect(output).toContain("Rerun setup with --ts-mode=tsc");
    const lib = project.readJson<Manifest>(LIB_MANIFEST);
    for (const field of [ "main", "types", "files" ]) expect(lib).not.toHaveProperty(field);
    expect(lib.exports).toEqual({ "./package.json": "./package.json" });
  });
});
