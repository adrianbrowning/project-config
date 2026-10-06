/**
 * Workspace protocol: internal dependencies normalised to `workspace:^`, others left alone, undeclared imports reported
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enforceWorkspaceProtocol, workspaceProtocolItems } from "../../src/workspace-protocol.ts";

let dir: string;
let originalCwd: string;

function write(file: string, content: Record<string, unknown> | string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
}

function readManifest(pkgDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, pkgDir, "package.json"), "utf8")) as Record<string, unknown>;
}

const summary = (dirs: Array<string>, managed = dirs) => workspaceProtocolItems(dirs, managed).map(item => [ item.status, item.label, item.reason ]);

beforeEach(() => {
  originalCwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-protocol-"));
  process.chdir(dir);
  write("libs/lib/package.json", { name: "@acme/lib", version: "1.2.0" });
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("workspaceProtocolItems", () => {
  it("normalises internal dependencies in every section without moving them, and ignores look-alikes", () => {
    write("apps/web/nested/package.json", {
      name: "@acme/web",
      dependencies: { "@acme/lib": "^1.0.0", "@acme/lib-extra": "^1.0.0" },
      devDependencies: { "lib-alias": "npm:@acme/lib@^1.1.0" },
      optionalDependencies: { "@acme/lib": "*" },
      peerDependencies: { "@acme/lib": "workspace:~" },
    });
    const dirs = [ "libs/lib", "apps/web/nested" ];
    const before = readManifest("apps/web/nested");

    expect(enforceWorkspaceProtocol(dirs, dirs)).toMatch(/^Internal dependencies: 3 set to workspace:\^, 0 to check\n/);
    expect(readManifest("apps/web/nested")).toEqual({
      ...before,
      dependencies: { "@acme/lib": "workspace:^", "@acme/lib-extra": "^1.0.0" },
      devDependencies: { "lib-alias": "workspace:@acme/lib@^" },
      optionalDependencies: { "@acme/lib": "workspace:^" },
      peerDependencies: { "@acme/lib": "workspace:~" },
    });
    expect(Object.keys(readManifest("apps/web/nested"))).toEqual(Object.keys(before));

    // A second run changes nothing
    expect(summary(dirs).map(([ status ]) => status)).toEqual([ "unchanged", "unchanged", "unchanged", "unchanged" ]);
    expect(enforceWorkspaceProtocol(dirs, dirs)).toBe("Internal dependencies use the workspace: protocol");
  });

  it("reports and keeps a spec the local package can't satisfy or that isn't a range", () => {
    write("libs/bare/package.json", { name: "bare" });
    write("apps/web/package.json", { name: "web", dependencies: { "@acme/lib": "^2.0.0", "bare": "^1.0.0" }, devDependencies: { "@acme/lib": "latest" } });
    const dirs = [ "libs/bare", "libs/lib", "apps/web" ];
    const before = fs.readFileSync(path.join(dir, "apps/web/package.json"), "utf8");

    expect(summary(dirs)).toEqual([
      [ "customized", path.join("apps/web", "package.json") + " › dependencies.@acme/lib", "\"^2.0.0\" doesn't match the local @acme/lib@1.2.0; left as is" ],
      [ "customized", path.join("apps/web", "package.json") + " › dependencies.bare", "bare has no valid version; left as is" ],
      [ "customized", path.join("apps/web", "package.json") + " › devDependencies.@acme/lib", "\"latest\" isn't a version range; left as is" ],
    ]);
    enforceWorkspaceProtocol(dirs, dirs);
    expect(fs.readFileSync(path.join(dir, "apps/web/package.json"), "utf8")).toBe(before);
  });

  it("only touches managed packages", () => {
    write("apps/web/package.json", { name: "web", dependencies: { "@acme/lib": "^1.0.0" } });
    write("apps/web/src/index.ts", "import \"@acme/other\";\n");
    write("libs/other/package.json", { name: "@acme/other", version: "1.0.0" });

    expect(summary([ "libs/lib", "libs/other", "apps/web" ], [ "libs/lib", "libs/other" ])).toEqual([]);
  });
});

describe("undeclared imports", () => {
  it("reports each internal package a package imports without declaring it, with both names", () => {
    write("libs/util/package.json", { name: "util", version: "1.0.0" });
    write("libs/declared/package.json", { name: "declared", version: "1.0.0" });
    write("apps/web/package.json", { name: "@acme/web", devDependencies: { declared: "workspace:^" } });
    write("apps/web/src/index.ts", [
      "import { a } from \"@acme/lib/sub/path\";",
      "export * from \"util\";",
      "import \"declared\";",
      "import self from \"@acme/web\";",
      "import { readFile } from \"node:fs\";",
      "import { local } from \"./local.ts\";",
      "import x from \"#src/x.ts\";",
      "",
    ].join("\n"));
    write("apps/web/src/more.cjs", "const again = require(\"@acme/lib\");\nconst later = await import (\"util\");\n");
    const dirs = [ "libs/declared", "libs/lib", "libs/util", "apps/web" ];

    expect(summary(dirs, [ "apps/web" ]).filter(([ status ]) => status === "customized")).toEqual([
      [ "customized", "@acme/web imports @acme/lib but doesn't declare it", "in apps/web/src/index.ts; add it to apps/web/package.json as \"workspace:^\"" ],
      [ "customized", "@acme/web imports util but doesn't declare it", "in apps/web/src/index.ts; add it to apps/web/package.json as \"workspace:^\"" ],
    ]);
  });

  it("finds dynamic imports and requires, and ignores comments, strings, look-alikes and other packages' files", () => {
    write("apps/web/package.json", { name: "web" });
    write("apps/web/src/a.mts", [
      "// import x from \"@acme/lib\";",
      "/* require(\"@acme/lib\") */",
      "const text = \"import y from '@acme/lib'\";",
      "const url = \"https://example.com\"; import z from \"@acme/lib-extra\";",
      "obj.require(\"@acme/lib\");",
      "",
    ].join("\n"));
    write("apps/web/node_modules/dep/index.js", "import \"@acme/lib\";\n");
    write("apps/web/dist/index.js", "import \"@acme/lib\";\n");
    write("apps/web/nested/package.json", { name: "nested", dependencies: { "@acme/lib": "workspace:^" } });
    write("apps/web/nested/index.ts", "import \"@acme/lib\";\n");
    const dirs = [ "libs/lib", "apps/web", "apps/web/nested" ];

    expect(summary(dirs).filter(([ status ]) => status === "customized")).toEqual([]);

    write("apps/web/src/b.tsx", "export const load = () => import(\"@acme/lib\");\n");
    expect(summary(dirs).filter(([ status ]) => status === "customized")
      .map(([ , label ]) => label)).toEqual([ "web imports @acme/lib but doesn't declare it" ]);
  });
});
