import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import {compareVersions, getPkgVersion, has, installPkg, writeConfigFile} from "./utils.ts";
import fs from "fs";
import type {ListrTask} from "listr2";

const Supported_Version = "__semanticrelease_version__";
const pkgName = '@gingacodemonkey/semantic-release-unsquash'

const configFile = {
    path: '.releaserc.json',
    content: {
        "branches": [
            "main"
        ],
        "plugins": [
            [
                "@gingacodemonkey/semantic-release-unsquash",
                {
                    "commitAnalyzerConfig": {
                        "releaseRules": [
                            {
                                "type": "feat",
                                "release": "minor"
                            },
                            {
                                "type": "fix",
                                "release": "patch"
                            },
                            {
                                "type": "docs",
                                "release": "patch"
                            },
                            {
                                "type": "style",
                                "release": "patch"
                            },
                            {
                                "type": "refactor",
                                "release": "patch"
                            },
                            {
                                "type": "perf",
                                "release": "patch"
                            },
                            {
                                "type": "test",
                                "release": "patch"
                            },
                            {
                                "type": "chore",
                                "release": "patch"
                            },
                            {
                                "type": "refactor",
                                "release": "patch"
                            },
                            {
                                "breaking": true,
                                "release": "major"
                            }
                        ]
                    },
                    "notesGeneratorConfig": {

                    }
                }
            ],
            [
                "@semantic-release/changelog",
                {
                    "changelogFile": "CHANGELOG.md"
                }
            ],
            [
                "@semantic-release/npm",
                {
                    "npmPublish": false,
                    "tarballDir": "dist"
                }
            ],
            [
                "@semantic-release/git",
                {
                    "assets": [
                        "CHANGELOG.md"
                    ]
                }
            ],
            [
                "@semantic-release/github",
                {
                    "assets": "dist/*.tgz"
                }
            ]
        ]
    }
};

const workflow= {
    path: '.github/workflows/{{actionName}}.yml',
    content: `name: Release

on:
  push:
    branches:
      - {{branch}}

jobs:
  release:
    runs-on: ubuntu-latest

    env:
      CI: true

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Release
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: pnpm exec semantic-release
`
}

export const semanticReleaseNotesTasks: Array<ListrTask> = [
    {
        title: 'Checking if SemanticRelease is installed',
        task: async (ctx: any, task: any) => {
            const eslintInstalled = getPkgVersion("@gingacodemonkey/semantic-release-unsquash");
            if (!eslintInstalled) {
                task.title = 'SemanticRelease not installed. Installing...';
                installLatestSemanticRelease(ctx.packageManager);
                return;
            }

            ctx.tsVersion = eslintInstalled;
            task.title = `SemanticRelease version ${eslintInstalled} detected`;

            if (compareVersions(eslintInstalled, Supported_Version) < 0) {
                const upgrade = await task.prompt(ListrEnquirerPromptAdapter).run({
                    type: 'confirm',
                    name: 'upgrade',
                    message: `Your SemanticRelease version is below ${Supported_Version}. Would you like to upgrade to the supported version?`,
                });
                if (upgrade) {
                    return task.newListr([{
                        title: 'Upgrading SemanticRelease to the supported version...',
                        task: async (ctx: any, task: any) => {
                            installLatestSemanticRelease(ctx.packageManager);
                        }
                        }],
                        { concurrent: false });
                }
                task.skip('Skipping SemanticRelease upgrade.');
                // throw new Error('Task aborted due to outdated SemanticRelease version');
            }

        }
    },
    {
        title: `Adding ${configFile.path} file`,
        task: writeConfigFile(configFile.path, JSON.stringify(configFile.content, null, 2))
    },
    {
        title: "Adding github action",
        task: async (ctx: any, task: any) => {

            ctx.actionName = 'release';

            if (fs.existsSync(`.github/workflows/${ctx.actionName}.yml`)) {
                ctx.actionName = await task.prompt(ListrEnquirerPromptAdapter).run({
                    type: 'input',
                    name: 'actionName',
                    initial: 'release',
                    message: `There is already a release.yml file. Please specify the name of the action.`,
                    validate: (value: string) => {
                        return !fs.existsSync(`.github/workflows/${value}.yml`)
                    }
                });
            }
        }
    },
    {
        title: "Adding github action",
        task: async (ctx: any, task: any) => {

            const branchName = await task.prompt(ListrEnquirerPromptAdapter).run({
                type: 'input',
                name: 'branchName',
                initial: 'main',
                message: `What is the name of the branch you want to release from?`,
            });

            return writeConfigFile(workflow.path.replace("{{actionName}}", ctx.actionName), workflow.content.replace("{{branch}}", branchName))(ctx, task);
        }
    },
    {
        title: 'Adding semantic-release script to package.json',
        task: async (ctx: any, task: any) => {
            const { updatePkgJsonScript } = await import('./utils.ts');
            updatePkgJsonScript('semantic-release', 'semantic-release');
        }
    }
    ];




function installLatestSemanticRelease(packageManager: string): void {
    const packages = [
        `${pkgName}@${Supported_Version}`,
        'semantic-release',
        '@semantic-release/changelog',
        '@semantic-release/git',
        '@semantic-release/npm',
        '@semantic-release/github'
    ];
    packages.forEach(pkg => installPkg(packageManager as any, pkg));
}
