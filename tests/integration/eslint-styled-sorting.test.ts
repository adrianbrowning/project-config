/**
 * Styled ESLint config: perfectionist sorting rules
 */

import { beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

type LintMessage = { message: string; ruleId: null | string; };
type LintResult = { messages: Array<LintMessage>; };
// `--print-config` normalises every rule to `[severity, ...options]`, with severity 0 meaning off.
type PrintedConfig = { rules: Record<string, [number, ...Array<unknown>]>; };

const SCRAMBLED_IMPORTS = `import { index } from "./index";
import { sibling } from "./sibling";
import { parent } from "../parent";
import { x } from "#utils/x";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";

export const all = [ fs, path, z, x, parent, sibling, index ];
`;

const SORTED_IMPORTS = [
  `import fs from "node:fs";`,
  `import path from "node:path";`,
  `import { z } from "zod";`,
  `import { x } from "#utils/x";`,
  `import { parent } from "../parent";`,
  `import { sibling } from "./sibling";`,
  `import { index } from "./index";`,
].join("\n");

describe("Styled ESLint config: perfectionist sorting", () => {
  let project: TestProject;

  // Rule ids reported for a file by the styled config. Parse errors show up as "fatal: <message>".
  function lintRules(file: string): Array<string> {
    const result = runCommand(project, `pnpm exec eslint --config eslint.config.style.ts --format json ${file}`, { expectFailure: true });
    const [ report ] = JSON.parse(result.stdout) as [LintResult];
    return report.messages.map(m => m.ruleId ?? `fatal: ${m.message}`);
  }

  function enabledRules(config: string): Array<string> {
    const printed = project.exec(`pnpm exec eslint --config ${config} --print-config src/index.ts`);
    const { rules } = JSON.parse(printed) as PrintedConfig;
    return Object.entries(rules)
      .filter(([ , [ severity ]]) => severity !== 0)
      .map(([ name ]) => name);
  }

  beforeAll(() => {
    project = new TestProject({ name: "eslint-styled-sorting" });
    project.runCli([ "--tool=ts", "--tool=eslint", "--yes", "--ts-no-dom", "--ts-type=library", "--ts-jsx=react-jsx" ]);
    // The generated tsconfig only includes `src/**.ts`; the JSX fixture needs `.tsx` in the project service.
    const tsconfig = project.readJson<{ include: Array<string>; }>("tsconfig.json");
    project.writeJson("tsconfig.json", { ...tsconfig, include: [ ...tsconfig.include, "./src/**.tsx" ] });
    project.writeFile("src/index.ts", "export const index = 1;\n");
    project.install();
  });

  it("reports out-of-order imports and --fix sorts them builtin → external → internal → parent → sibling → index", () => {
    project.writeFile("src/imports.ts", SCRAMBLED_IMPORTS);
    expect(lintRules("src/imports.ts")).toContain("perfectionist/sort-imports");

    runCommand(project, "pnpm exec eslint --config eslint.config.style.ts --fix src/imports.ts", { expectFailure: true });

    expect(project.readFile("src/imports.ts")).toContain(SORTED_IMPORTS);
  });

  it("reports unsorted named imports and exports", () => {
    project.writeFile("src/named.ts", `import { b, a } from "x";\nconst c = 1;\nconst d = 2;\nexport { d, c };\nexport const all = [ a, b ];\n`);
    const rules = lintRules("src/named.ts");

    expect(rules).toContain("perfectionist/sort-named-imports");
    expect(rules).toContain("perfectionist/sort-named-exports");
  });

  it("reports unsorted union types, interfaces and object types", () => {
    project.writeFile("src/types.ts", `export type T = "b" | "a";
export interface I { b: string; a: string; }
export type O = { b: string; a: string; };
`);
    const rules = lintRules("src/types.ts");

    expect(rules).toContain("perfectionist/sort-union-types");
    expect(rules).toContain("perfectionist/sort-interfaces");
    expect(rules).toContain("perfectionist/sort-object-types");
  });

  it("reports unsorted JSX props", () => {
    project.writeFile("src/props.tsx", `function X(_props: { a: boolean; b: boolean; }) {
  return null;
}
export const el = <X b a />;
`);

    expect(lintRules("src/props.tsx")).toContain("perfectionist/sort-jsx-props");
  });

  it("sorts naturally: item2 before item10", () => {
    project.writeFile("src/natural.ts", `export type N = "item2" | "item10";\n`);
    expect(lintRules("src/natural.ts")).not.toContain("perfectionist/sort-union-types");

    project.writeFile("src/natural.ts", `export type N = "item10" | "item2";\n`);
    expect(lintRules("src/natural.ts")).toContain("perfectionist/sort-union-types");
  });

  it("styled config no longer enables import/order", () => {
    const rules = enabledRules("eslint.config.style.ts");

    expect(rules).toContain("perfectionist/sort-imports");
    expect(rules).not.toContain("import/order");
  });

  it("base config enables no perfectionist rule", () => {
    expect(enabledRules("eslint.config.ts").filter(r => r.startsWith("perfectionist/"))).toEqual([]);
  });
});
