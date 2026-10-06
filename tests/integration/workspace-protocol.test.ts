/**
 * workspace: protocol for internal dependencies: normalised by setup and --update, linked locally on install,
 * rewritten to semver ranges on pack, and undeclared internal imports reported
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

type Manifest = Record<string, unknown> & { dependencies?: Record<string, string>; };

const WEB = "apps/web/nested";
const SETUP = [ "--tool=workspace", "--yes", "--workspace-update-all" ];

/**
 * Scoped internal libraries and a consumer in a nested dir (its own glob), using plain ranges in every dependency
 * section. `@acme/lib-extra` is a look-alike outside the workspace, resolved by an override so install stays offline.
 * The consumer imports `@acme/theme` without declaring it.
 */
function seedWorkspace(project: TestProject): void {
  project.writeFile("pnpm-workspace.yaml", `packages:\n  - 'libs/*'\n  - '${WEB}'\noverrides:\n  '@acme/lib-extra': 'link:./vendor/lib-extra'\n`);
  project.writeJson("vendor/lib-extra/package.json", { name: "@acme/lib-extra", version: "1.0.0" });
  for (const [ name, version ] of [[ "lib", "1.2.0" ], [ "util", "2.0.0" ], [ "icons", "1.0.0" ], [ "theme", "1.0.0" ]]) {
    project.writeJson(`libs/${name}/package.json`, { name: `@acme/${name}`, version, type: "module", exports: { ".": "./src/index.js", "./*": "./src/*.js" } });
    project.writeFile(`libs/${name}/src/index.js`, `export const ${name} = "${name}";\n`);
  }
  project.writeJson(`${WEB}/package.json`, {
    name: "@acme/web",
    version: "0.1.0",
    type: "module",
    dependencies: { "@acme/lib": "^1.0.0", "@acme/lib-extra": "^1.0.0" },
    devDependencies: { "@acme/util": "2.0.0" },
    optionalDependencies: { "@acme/icons": "*" },
    peerDependencies: { "@acme/util": "^2.0.0" },
  });
  project.writeFile(`${WEB}/src/index.ts`, "import { lib } from \"@acme/lib\";\nimport { colors } from \"@acme/theme/colors\";\n\nexport const all = [ lib, colors ];\n");
}

function manifests(project: TestProject): Record<string, string> {
  return Object.fromEntries([ "lib", "util", "icons", "theme" ].map(name => `libs/${name}/package.json`)
    .concat(`${WEB}/package.json`)
    .map(file => [ file, project.readFile(file) ]));
}

describe("workspace: protocol for internal dependencies", () => {
  it("setup normalises every section in place, links locally, packs semver ranges and never falls back to the registry", () => {
    using project = new TestProject({ name: "workspace-protocol" });
    seedWorkspace(project);

    const output = project.runCli(SETUP);

    expect(output).toContain("Internal dependencies: 4 set to workspace:^, 1 to check");
    expect(output).toContain("@acme/web imports @acme/theme but doesn't declare it");
    // Each entry stays in its own section; only the internal ones change
    const web = project.readJson<Manifest>(`${WEB}/package.json`);
    expect(Object.fromEntries(Object.entries(web).filter(([ key ]) => key.endsWith("ependencies")))).toEqual({
      dependencies: { "@acme/lib": "workspace:^", "@acme/lib-extra": "^1.0.0" },
      devDependencies: { "@acme/util": "workspace:^" },
      optionalDependencies: { "@acme/icons": "workspace:^" },
      peerDependencies: { "@acme/util": "workspace:^" },
    });

    // Rerunning changes nothing; the undeclared import is still reported
    const before = manifests(project);
    expect(project.runCli(SETUP)).toContain("Internal dependencies: 0 set to workspace:^, 1 to check");
    expect(manifests(project)).toEqual(before);

    // The consumer gets the local packages
    project.install();
    const real = (file: string) => fs.realpathSync(path.join(project.dir, file));
    expect(real(`${WEB}/node_modules/@acme/lib`)).toBe(real("libs/lib"));
    expect(real(`${WEB}/node_modules/@acme/util`)).toBe(real("libs/util"));
    expect(real(`${WEB}/node_modules/@acme/lib-extra`)).toBe(real("vendor/lib-extra"));

    // Packing turns workspace:^ into a caret range on the local version
    project.exec(`cd ${WEB} && pnpm pack --pack-destination ../../../.pack`);
    const packed = JSON.parse(project.exec("tar -xzOf .pack/acme-web-0.1.0.tgz package/package.json")) as Manifest;
    expect(packed).toMatchObject({
      dependencies: { "@acme/lib": "^1.2.0", "@acme/lib-extra": "^1.0.0" },
      devDependencies: { "@acme/util": "^2.0.0" },
      optionalDependencies: { "@acme/icons": "^1.0.0" },
      peerDependencies: { "@acme/util": "^2.0.0" },
    });

    // With the internal package gone, install fails instead of looking for @acme/lib on the registry
    fs.renameSync(path.join(project.dir, "libs/lib"), path.join(project.dir, "lib-moved"));
    try {
      const result = runCommand(project, "pnpm install --no-frozen-lockfile", { expectFailure: true });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(/ERR_PNPM_WORKSPACE_PKG_NOT_FOUND[\s\S]*@acme\/lib/);
    }
    finally {
      fs.renameSync(path.join(project.dir, "lib-moved"), path.join(project.dir, "libs/lib"));
    }
  });

  it("--update normalises plain ranges again, reports what it leaves, and is idempotent", () => {
    using project = new TestProject({ name: "workspace-protocol-update" });
    seedWorkspace(project);
    project.runCli(SETUP);
    const web = project.readJson<Manifest>(`${WEB}/package.json`);
    project.writeJson(`${WEB}/package.json`, { ...web, dependencies: { ...web.dependencies, "@acme/lib": "~1.2.0" }, devDependencies: { "@acme/util": "^3.0.0" } });

    const update = () => runCommand(project, "pnpm exec gingacodemonkey-config --update --tool=workspace --yes", { expectFailure: true });
    const first = update();

    expect(first.exitCode, first.stdout).toBe(0);
    expect(first.stdout).toContain(`updated    ${WEB}/package.json › dependencies.@acme/lib ("~1.2.0" → "workspace:^")`);
    expect(first.stdout).toContain(`customized ${WEB}/package.json › devDependencies.@acme/util ("^3.0.0" doesn't match the local @acme/util@2.0.0; left as is)`);
    expect(first.stdout).toContain("customized @acme/web imports @acme/theme but doesn't declare it");
    expect(project.readJson<Manifest>(`${WEB}/package.json`)).toMatchObject({
      dependencies: { "@acme/lib": "workspace:^" },
      devDependencies: { "@acme/util": "^3.0.0" },
    });

    const before = manifests(project);
    const second = update();
    expect(second.stdout).toContain("Nothing to update.");
    expect(manifests(project)).toEqual(before);
  });
});
