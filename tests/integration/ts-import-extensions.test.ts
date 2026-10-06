/**
 * Explicit `.ts` import specifiers (`import "./dependency.ts"`) across every published preset.
 * Bundler presets must type-check them; tsc presets must emit `.js` specifiers Node can run,
 * and library declarations must resolve for a consumer.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

const DOMS = [ "dom", "no-dom" ] as const;
const TYPES = [ "app", "library", "library-monorepo" ] as const;
const presets = (mode: "bundler" | "tsc") => DOMS.flatMap(dom => TYPES.map(type => `${mode}/${dom}/${type}`));

function writeSources(project: TestProject): void {
  project.writeFile("src/dependency.ts", "export const value: number = 42;\n");
  project.writeFile("src/types.ts", "export type Value = number;\n");
  project.writeFile("src/index.ts", [
    "import { value } from \"./dependency.ts\";",
    "import type { Value } from \"./types.ts\";",
    "export const doubled: Value = value * 2;",
    "export { value };",
    "export type { Value } from \"./types.ts\";",
    "",
  ].join("\n"));
}

function writeTsconfig(project: TestProject, preset: string): void {
  project.writeJson("tsconfig.json", {
    extends: `@gingacodemonkey/config/${preset}`,
    compilerOptions: { outDir: "dist", rootDir: "src" },
    include: [ "src" ],
  });
}

describe("explicit .ts import extensions", () => {
  let project: TestProject;
  beforeEach(() => {
    project = new TestProject({ name: "ts-ext" });
    // tsc presets use NodeNext; pin ESM so the emitted import specifiers are what we assert on.
    project.writeJson("package.json", { ...project.readJson<object>("package.json"), type: "module" });
    writeSources(project);
  });
  afterEach(() => {
    project.cleanup();
  });

  it.each(presets("bundler"))("%s type-checks .ts specifiers", preset => {
    writeTsconfig(project, preset);
    runCommand(project, "pnpm exec tsc --noEmit -p tsconfig.json");
  });

  it.each(presets("tsc"))("%s emits .js specifiers that run under Node", preset => {
    writeTsconfig(project, preset);
    runCommand(project, "pnpm exec tsc -p tsconfig.json");

    const js = project.readFile("dist/index.js");
    expect(js).toContain("\"./dependency.js\"");
    expect(js).not.toContain(".ts\"");

    const run = runCommand(project, "node --input-type=module -e \"const m = await import('./dist/index.js'); console.log(m.value, m.doubled);\"");
    expect(run.stdout.trim()).toBe("42 84");
  });

  it.each(presets("tsc").filter(preset => !preset.endsWith("/app")))("%s declarations resolve for a consumer", preset => {
    writeTsconfig(project, preset);
    runCommand(project, "pnpm exec tsc -p tsconfig.json");

    // If a `.ts` specifier in dist/*.d.ts failed to resolve, `Value` would be `any` and both
    // expect-error directives below would be unused, failing the check.
    project.writeFile("consumer.ts", [
      "import { value, type Value } from \"./dist/index.js\";",
      "// @ts-expect-error value is a number",
      "export const s: string = value;",
      "// @ts-expect-error Value is number",
      "export const v: Value = \"nope\";",
      "",
    ].join("\n"));
    project.writeJson("tsconfig.consumer.json", {
      compilerOptions: { module: "nodenext", strict: true, noEmit: true, types: [] },
      files: [ "consumer.ts" ],
    });
    runCommand(project, "pnpm exec tsc -p tsconfig.consumer.json");
  });
});
