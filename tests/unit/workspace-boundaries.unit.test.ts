/**
 * gingacodemonkey/workspace-boundaries: packages reach each other only through their public exports, however the
 * import is spelled
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceBoundariesPlugin } from "../../src/workspace-boundaries.ts";

let root: string;
const SITE_FILE = "apps/web/site/src/main.ts";

function write(file: string, content: string): void {
  fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  write(`${dir}/package.json`, JSON.stringify(manifest));
}

/** The boundary rule's message ids for `code` linted as `file` (relative to the workspace root). */
function lint(code: string, file = SITE_FILE, options?: Record<string, unknown>): Array<string | undefined> {
  const linter = new Linter({ cwd: root });
  const config: Array<Linter.Config> = [{
    files: [ "**/*.ts" ],
    languageOptions: { parser: tseslint.parser },
    plugins: { gingacodemonkey: workspaceBoundariesPlugin },
    rules: { "gingacodemonkey/workspace-boundaries": options ? [ "error", options ] : "error" },
  }];
  const messages = linter.verify(code, config, path.join(root, file));
  expect(messages.filter(message => message.ruleId !== "gingacodemonkey/workspace-boundaries")).toEqual([]);
  return messages.map(message => message.messageId);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-boundaries-"));
  // Nested (apps/**), single-directory (tools/custom) and nested-in-a-package globs, plus an exclusion
  write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - \"apps/**\"\n  - tools/custom/\n  - packages/lib/vendor\n  - '!apps/ignored'\n");
  writeManifest("packages/lib", {
    name: "@scope/lib",
    exports: {
      ".": "./src/index.ts",
      "./utils": { types: "./src/utils.ts", default: "./src/utils.ts" },
      "./features/*": "./src/features/*.ts",
      "./features/secret": null,
    },
    imports: { "#src/*": "./src/*" },
  });
  for (const file of [ "index", "utils", "internal", "features/a", "generated/schema" ]) write(`packages/lib/src/${file}.ts`, "export {};\n");
  writeManifest("packages/lib/vendor", { name: "@scope/vendor" });
  write("packages/lib/vendor/src/index.ts", "export {};\n");
  writeManifest("packages/legacy", { name: "legacy" });
  write("packages/legacy/src/index.ts", "export {};\n");
  writeManifest("tools/custom", { name: "custom-tool" });
  write("tools/custom/index.ts", "export {};\n");
  writeManifest("apps/ignored", { name: "ignored" });
  write("apps/ignored/src/index.ts", "export {};\n");
  writeManifest("apps/web/site", {
    name: "@scope/site",
    imports: {
      "#src/*": "./src/*",
      "#lib/*": "../../../packages/lib/src/*",
      "#bad": { types: "./src/local.ts", default: "@scope/lib/src/internal.ts" },
      "#ok": "@scope/lib/utils",
    },
  });
  write(SITE_FILE, "");
  write("apps/web/site/src/local.ts", "export {};\n");
  // How pnpm links a workspace dependency
  fs.mkdirSync(path.join(root, "apps/web/site/node_modules/@scope"), { recursive: true });
  fs.symlinkSync(path.join(root, "packages/lib"), path.join(root, "apps/web/site/node_modules/@scope/lib"), "dir");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("workspace-boundaries", () => {
  it.each([
    [ "the package name", "@scope/lib" ],
    [ "a declared subpath export", "@scope/lib/utils" ],
    [ "a pattern export", "@scope/lib/features/a" ],
    [ "a package without exports by name", "legacy" ],
    [ "a package from a custom glob by name", "custom-tool" ],
    [ "an excluded directory's package", "ignored/src/index.ts" ],
    [ "an external package", "react" ],
    [ "an external subpath", "lodash/fp" ],
    [ "a node builtin", "node:fs" ],
    [ "a relative file in the same package", "./local.ts" ],
    [ "a relative path that leaves and re-enters its own package", "../../site/src/local.ts" ],
    [ "the package's own #src alias", "#src/local.ts" ],
    [ "an alias mapped to a public export", "#ok" ],
    [ "a self-reference", "@scope/site/src/local.ts" ],
    [ "a relative path into an excluded directory", "../../../ignored/src/index.ts" ],
  ])("allows %s (%s)", (_name, specifier) => {
    expect(lint(`import "${specifier}";`)).toEqual([]);
  });

  it.each([
    [ "a sibling's src", "@scope/lib/src/internal", "privateExport" ],
    [ "a sibling's src with a .ts extension", "@scope/lib/src/internal.ts", "privateExport" ],
    [ "a sibling's src with a .js extension", "@scope/lib/src/internal.js", "privateExport" ],
    [ "a public export spelled with an extension", "@scope/lib/utils.ts", "privateExport" ],
    [ "a sibling's index file", "@scope/lib/index.js", "privateExport" ],
    [ "a sibling's src directory", "@scope/lib/src", "privateExport" ],
    [ "an export set to null", "@scope/lib/features/secret", "privateExport" ],
    [ "a subpath of a package without exports", "legacy/src/index.ts", "privateExport" ],
    [ "a doubled slash", "@scope/lib//src/internal", "privateExport" ],
    [ "a `..` through the importer's own name", "@scope/site/../lib/src/internal", "privateExport" ],
    [ "a `./` segment", "@scope/lib/./utils", "nonCanonical" ],
    [ "a trailing slash", "@scope/lib/", "nonCanonical" ],
    [ "a `..` that lands on a public export", "@scope/lib/src/../utils", "nonCanonical" ],
    [ "different case", "@Scope/Lib/utils", "nonCanonical" ],
    [ "a relative path into a sibling's src", "../../../../packages/lib/src/internal.ts", "crossPackage" ],
    [ "a relative path with ./ and a .js extension", "./../../../../packages/lib/src/internal.js", "crossPackage" ],
    [ "a relative path with // and /./ and a trailing slash", "../../../..//packages/./lib/src/", "crossPackage" ],
    [ "a relative path to a sibling's root (its index)", "../../../../packages/lib", "crossPackage" ],
    [ "a `..` that re-enters another package", "../../../../packages/legacy/../lib/src/utils.ts", "crossPackage" ],
    [ "a relative path through the node_modules symlink", "../node_modules/@scope/lib/src/internal.ts", "crossPackage" ],
    [ "a relative path into a package from a custom glob", "../../../../tools/custom/index.ts", "crossPackage" ],
    [ "an alias mapped into a sibling's src", "#lib/internal.ts", "aliasEscape" ],
    [ "an alias whose condition maps to a sibling's private path", "#bad", "aliasEscape" ],
  ])("rejects %s (%s)", (_name, specifier, messageId) => {
    expect(lint(`import "${specifier}";`)).toEqual([ messageId ]);
  });

  it("rejects absolute paths and file: URLs into a sibling", () => {
    const internal = path.join(root, "packages/lib/src/internal.ts");
    expect(lint(`import "${internal}";\nimport "file://${internal}";`)).toEqual([ "crossPackage", "crossPackage" ]);
  });

  // On a case-sensitive file system the differently-cased path doesn't exist, so it reaches nothing
  it.runIf(fs.existsSync(os.tmpdir().toUpperCase()))("rejects a differently-cased relative path on a case-insensitive file system", () => {
    expect(lint(`import "../../../../PACKAGES/Lib/SRC/internal.ts";`)).toEqual([ "crossPackage" ]);
  });

  it("checks every import form", () => {
    const code = [
      `import { a } from "@scope/lib/src/internal";`,
      `import type { T } from "@scope/lib/src/internal";`,
      `export * from "@scope/lib/src/internal";`,
      `export { b } from "@scope/lib/src/internal";`,
      `await import("@scope/lib/src/internal");`,
      "await import(`@scope/lib/src/internal`);",
      `require("@scope/lib/src/internal");`,
      `import c = require("@scope/lib/src/internal");`,
      `type U = import("@scope/lib/src/internal").U;`,
    ].join("\n");
    expect(lint(code)).toHaveLength(9);
  });

  it("keeps nested packages apart from the package around them", () => {
    expect(lint(`import "../vendor/src/index.ts";`, "packages/lib/src/index.ts")).toEqual([ "crossPackage" ]);
    expect(lint(`import "../../src/utils.ts";`, "packages/lib/vendor/src/index.ts")).toEqual([ "crossPackage" ]);
    expect(lint(`import "#src/utils.ts";\nimport "./internal.ts";`, "packages/lib/src/index.ts")).toEqual([]);
  });

  it("ignores files outside every package", () => {
    expect(lint(`import "@scope/lib/src/internal";\nimport "../packages/lib/src/internal.ts";`, "scripts/build.ts")).toEqual([]);
  });

  it("lets an allow list through by package path, however the import is written", () => {
    const options = { allow: [ "@scope/lib/src/generated/**" ] };
    const code = [
      `import "@scope/lib/src/generated/schema.ts";`,
      `import "../../../../packages/lib/src/generated/schema.ts";`,
      `import "@scope/lib/src/internal.ts";`,
    ].join("\n");
    expect(lint(code, SITE_FILE, options)).toEqual([ "privateExport" ]);
  });
});
