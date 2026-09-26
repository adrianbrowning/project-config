import fs from "node:fs";
import path from "node:path";
import type { ListrTask } from "listr2";
import type { TaskContext } from "./cli-args.ts";
import { SETUP_ACTION, SETUP_ACTION_PATH } from "./github-actions-tasks.ts";
import { compareVersions, getPackageJson, getPkgVersion, updatePkgJsonScript, writeConfigFile } from "./utils.ts";

const Supported_Version = "__bumpy_version__";
const pkgName = "@varlock/bumpy";

// Workflow file contents — replaced at build time from github_actions_examples/
const BUMPY_CHECK_WORKFLOW = "__BUMPY_CHECK_WORKFLOW__";
const BUMPY_COMMENT_WORKFLOW = "__BUMPY_COMMENT_WORKFLOW__";
const RELEASE_GITHUB_WORKFLOW = "__RELEASE_GITHUB_WORKFLOW__";
const RELEASE_NPM_WORKFLOW = "__RELEASE_NPM_WORKFLOW__";

// Bumpy only creates GitHub releases for packages with a publish target, and
// `skipNpmPublish` leaves none. GitHub-only mode therefore uses a custom target:
// pack the package and attach the tarball to Bumpy's draft release.
const PACK_DIR = "\"${RUNNER_TEMP:-/tmp}/bumpy-pack\"";
const GITHUB_RELEASE_PUBLISH_COMMAND = [
  `rm -rf ${PACK_DIR}`,
  `pnpm pack --pack-destination ${PACK_DIR}`,
  `gh release upload {{name}}@{{version}} ${PACK_DIR}/*.tgz --clobber`,
];

export type BumpyOptions = {
  npm: boolean;
};

function createBumpyConfig(name: string, npm: boolean) {
  const config = {
    baseBranch: "main",
    changelog: "github",
    include: [ name ],
  };
  if (npm) {
    return { ...config, access: "public", publish: { provenance: true } };
  }
  return { ...config, packages: { [name]: { publishCommand: GITHUB_RELEASE_PUBLISH_COMMAND } } };
}

export function createBumpyTasks(options: BumpyOptions): Array<ListrTask<TaskContext>> {
  const { name } = getPackageJson();
  if (!name) throw new Error("Bumpy needs a \"name\" in package.json");

  return [
    {
      title: "Checking if Bumpy is installed",
      task: (ctx, task) => {
        const installed = getPkgVersion(pkgName);
        if (installed && compareVersions(installed, Supported_Version) >= 0) {
          task.title = `Bumpy version ${installed} detected`;
          return;
        }
        task.title = "Queuing Bumpy install...";
        ctx.packages.add(`${pkgName}@${Supported_Version}`);
      },
    },
    {
      title: "Adding bump scripts to package.json",
      task: () => {
        updatePkgJsonScript("bump", "bumpy add");
        updatePkgJsonScript("bump:status", "bumpy status");
      },
    },
    {
      title: "Adding .bumpy/_config.json",
      task: writeConfigFile(".bumpy/_config.json", JSON.stringify(createBumpyConfig(name, options.npm), null, 2)),
    },
    {
      title: "Adding reusable setup action",
      skip: () => fs.existsSync(SETUP_ACTION_PATH) && `${SETUP_ACTION_PATH} already exists`,
      task: () => {
        fs.mkdirSync(path.dirname(SETUP_ACTION_PATH), { recursive: true });
        fs.writeFileSync(SETUP_ACTION_PATH, SETUP_ACTION);
      },
    },
    {
      title: "Setting up Bumpy check workflow",
      task: writeConfigFile(".github/workflows/bumpy-check.yml", BUMPY_CHECK_WORKFLOW),
    },
    {
      title: "Setting up Bumpy comment workflow",
      task: writeConfigFile(".github/workflows/bumpy-comment.yml", BUMPY_COMMENT_WORKFLOW),
    },
    {
      title: "Setting up release workflow",
      task: writeConfigFile(".github/workflows/release.yml", options.npm ? RELEASE_NPM_WORKFLOW : RELEASE_GITHUB_WORKFLOW),
    },
  ];
}
