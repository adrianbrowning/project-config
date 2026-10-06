/**
 * Explicit `.ts` import specifiers (`import "./dependency.ts"`) across every published preset.
 * Bundler presets must type-check them; tsc presets must emit `.js` specifiers Node can run,
 * and library declarations must resolve for a consumer.
 *
 * Cloning a TestProject takes most of a test's time, so every case shares one project and gets its
 * own directory; `@gingacodemonkey/config` and `@types/node` resolve from the project's node_modules.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

const DOMS = [ "dom", "no-dom" ] as const;
const TYPES = [ "app", "library", "library-monorepo" ] as const;
const presets = (mode: "bundler" | "tsc") => DOMS.flatMap(dom => TYPES.map(type => `${mode}/${dom}/${type}`));
const TSC = "./node_modules/.bin/tsc";

/** Writes the fixture and a tsconfig extending `preset` into its own directory; returns that directory. */
function writeCase(project: TestProject, name: string, preset: string): string {
  const dir = `cases/${name}-${preset.replaceAll("/", "-")}`;
  // tsc presets use NodeNext; pin ESM so the emitted import specifiers are what we assert on.
  project.writeJson(`${dir}/package.json`, { type: "module" });
  project.writeFile(`${dir}/src/dependency.ts`, "export const value: number = 42;\n");
  project.writeFile(`${dir}/src/types.ts`, "export type Value = number;\n");
  project.writeFile(`${dir}/src/index.ts`, [
    "import { value } from \"./dependency.ts\";",
    "import type { Value } from \"./types.ts\";",
    "export const doubled: Value = value * 2;",
    "export { value };",
    "export type { Value } from \"./types.ts\";",
    "",
  ].join("\n"));
  project.writeJson(`${dir}/tsconfig.json`, {
    extends: `@gingacodemonkey/config/${preset}`,
    // The preset's build info path lives inside the shared package; keep each case's own.
    compilerOptions: { outDir: "dist", rootDir: "src", tsBuildInfoFile: "./.tsbuildinfo" },
    include: [ "src" ],
  });
  return dir;
}

describe("explicit .ts import extensions", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "ts-ext" });
  });
  afterAll(() => {
    project.cleanup();
  });

  it.each(presets("bundler"))("%s type-checks .ts specifiers", preset => {
    const dir = writeCase(project, "check", preset);
    runCommand(project, `${TSC} --noEmit -p ${dir}/tsconfig.json`);
  });

  it.each(presets("tsc"))("%s emits .js specifiers that run under Node", preset => {
    const dir = writeCase(project, "emit", preset);
    runCommand(project, `${TSC} -p ${dir}/tsconfig.json`);

    const js = project.readFile(`${dir}/dist/index.js`);
    expect(js).toContain("\"./dependency.js\"");
    expect(js).not.toContain(".ts\"");

    const run = runCommand(project, `node --input-type=module -e "const m = await import('./${dir}/dist/index.js'); console.log(m.value, m.doubled);"`);
    expect(run.stdout.trim()).toBe("42 84");
  });

  it.each(presets("tsc").filter(preset => !preset.endsWith("/app")))("%s declarations resolve for a consumer", preset => {
    const dir = writeCase(project, "dts", preset);
    runCommand(project, `${TSC} -p ${dir}/tsconfig.json`);

    // If a `.ts` specifier in dist/*.d.ts failed to resolve, `Value` would be `any` and both
    // expect-error directives below would be unused, failing the check.
    project.writeFile(`${dir}/consumer.ts`, [
      "import { value, type Value } from \"./dist/index.js\";",
      "// @ts-expect-error value is a number",
      "export const s: string = value;",
      "// @ts-expect-error Value is number",
      "export const v: Value = \"nope\";",
      "",
    ].join("\n"));
    project.writeJson(`${dir}/tsconfig.consumer.json`, {
      compilerOptions: { module: "nodenext", strict: true, noEmit: true, types: [] },
      files: [ "consumer.ts" ],
    });
    runCommand(project, `${TSC} -p ${dir}/tsconfig.consumer.json`);
  });
});
