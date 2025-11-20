import fs from "node:fs";
import Path from "node:path";
import * as enquirer from 'enquirer';
import {execSync} from "child_process";
import { Listr} from 'listr2'
import {detectPackageManager} from "./utils.js";
import {tsTasks} from "./ts-tasks.js";
import {esLintTasks} from "./eslint-tasks.js";
import {huskyTasks} from "./husky-tasks.js";
import {commitLintTasks} from "./convential-tasks.js";
import {lintstagedTasks} from "./lintstaged-tasks.js";
import {semanticReleaseNotesTasks} from "./sematic-release-tasks.js";
import {knipTasks} from "./knip-tasks.js";

const {MultiSelect} = enquirer.default;

const tools = [
    {name: 'TS', value: 'ts'},
    {name: 'ESLint', value: 'eslint'},
    {name: 'Husky', value: 'husky'},
    {name: 'CommitLint', value: 'commitLint'},
    {name: 'Lint-Staged', value: 'lintStaged'},
    {name: 'Semantic Release Notes', value: 'semanticReleaseNotes'},
    {name: 'Knip', value: 'knip'}
]
const enable = (choices, fn) => choices.forEach(ch => (ch.enabled = fn(ch)));
const prompt = new MultiSelect({
    name: 'tool',
    message: 'Please select what to install',
    hint: '(Use <space> to select, <return> to submit)',
    choices: [
        {name: 'All', value: 'all',
            onChoice(state, choice, i) {
                if (state.index === i && choice.enabled) {
                    enable(state.choices, ch => ch.name !== 'none');
                }
            }
        },
        ...tools,
    ],
    result(names) {
        return Object.values(this.map(names));
    },
    onSubmit() {
        if (this.selected.length === 0) {
            this.enable(this.focused);
        }
    }
});


const tasks = new Listr(
    [
        {
            title: 'Detecting Package Manager',
            task: async (ctx, task) => {
                ctx.packageManager = await detectPackageManager(task);
            }
        },
    ],

    {
        concurrent: false,
    }
)

prompt.run()
    .then(answer => {
        console.log(answer);
        if (answer.length === 0) {
            console.log("Nothing to do.")
            return;
        }
        if (answer.includes("ts")) tasks.add({
            title: "TypeScript",
            task: async (ctx, task) => {
                return task.newListr(tsTasks, {concurrent: false });
            }
        });
        if (answer.includes("eslint")) tasks.add({
            title: "ESLint",
            task: async (ctx, task) => {
                return task.newListr(esLintTasks, {concurrent: false });
            }
        });
        if (answer.includes("husky")) tasks.add({
            title: "Husky",
            task: async (ctx, task) => {
                return task.newListr(huskyTasks, {concurrent: false });
            }
        });
        if (answer.includes("commitLint")) tasks.add({
            title: "CommitLint",
            task: async (ctx, task) => {
                return task.newListr(commitLintTasks, {concurrent: false });
            }
        });
        if (answer.includes("lintStaged")) tasks.add({
            title: "LintStaged",
            task: async (ctx, task) => {
                return task.newListr(lintstagedTasks, {concurrent: false });
            }
        });
        if (answer.includes("semanticReleaseNotes")) tasks.add({
            title: "Semantic Release Notes",
            task: async (ctx, task) => {
                return task.newListr(semanticReleaseNotesTasks, {concurrent: false });
            }
        });
        if (answer.includes("knip")) tasks.add({
            title: "Knip",
            task: async (ctx, task) => {
                return task.newListr(knipTasks, {concurrent: false });
            }
        });

        return tasks.run()
    })
    .catch(console.error);


// Define file contents

// Install dependencies


function stuff() {

    const files = {
        'eslint.config.style.js': `
import { config as defaultConfig } from '@gingacodemonkey/config/styled'

/** @type {import("eslint").Linter.Config} */
export default [...defaultConfig]
`,
        '.husky/pre-commit': 'pnpm exec lint-staged\n',
        '.husky/commit-msg': `
pnpm exec commitlint --edit "$1";
FILE=$1
MESSAGE=$(cat $FILE)
TICKET=[$(git rev-parse --abbrev-ref HEAD | grep -Eo '^(\w+/)?(\w+[-_])?[0-9]+' | grep -Eo '(\w+[-])?[0-9]+' | tr "[:lower:]" "[:upper:]")]
if [[ $TICKET == "[]" || "$MESSAGE" == "$TICKET"* ]];then
  exit 0;
fi
# Strip leading '['
TICKET="\${TICKET#\\[}"
# Strip trailing ']'
TICKET="\${TICKET %\\]}"
echo $"$TICKET\\n\\n$MESSAGE" > $FILE
`,
        '.lintstagedrc': JSON.stringify({
            '*.{js,ts,tsx}': ['eslint --config eslint.config.style.js --fix --max-warnings=0 --cache']
        }, null, 2),
        'commitlint.config.js': `
export default {
  "extends": [ "@commitlint/config-conventional" ],
  "rules": {
    "subject-case": [ 2, "always", [ "sentence-case", "lower-case" ]],
  },
};
`,
        '.github/workflows/release.yml': `
    name: Release

on:
  push:
    branches:
      - main

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
#          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: pnpm exec semantic-release

`,
        '.releaserc.json': JSON.stringify({
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
                        "notesGeneratorConfig": {}
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
        }, null, 2)
    };

// Create files
    for (const [file, content] of Object.entries(files)) {
        const filePath = Path.join(process.cwd(), file);
        writeToFile(filePath, content.trim() + "\n");
    }

    const devDep = [
        "husky",
        "@commitlint/cli",
        "@commitlint/config-conventional",
        "lint-staged",
        "@gingacodemonkey/semantic-release-unsquash",
        "@semantic-release/changelog",
        "@semantic-release/commit-analyzer",
        "@semantic-release/git",
        "@semantic-release/npm",
        "@semantic-release/release-notes-generator",
        "@semantic-release/exec",
        "semantic-release"
    ];

    execSync(`pnpm i -D ${devDep.join(" ")}`, {stdio: 'inherit'});

    execSync('pnpm exec husky init', {stdio: 'inherit'});


    function ensureDir(dir) {
        try {
            fs.mkdirSync(dir, {recursive: true});
        } catch (err) {
            if (err.code !== 'EEXIST') throw err
        }
    }

    function writeToFile(path, data) {
        const {dir} = Path.parse(path);
        ensureDir(dir);
        fs.writeFileSync(path, data, {encoding: 'utf8'});

    }

}



// 1. TS Config
// 1.1. Check if TS installed
// 1.1.1 If installed make sure at least 5.6.3
// 1.1.1.1 If not, ask to upgrade or abort task
// 1.1.1.2 Upgrade TS to latest
// 1.1.2 Check if a tsconfig is defined
// 1.1.2.1 If defined ask to overwrite
// 1.1.2.2 If no, abort task,
// 1.1.2.2 If yes ask which to install

// 1. ESLint
// 1.1. Check if ESLint is installed
// 1.1.1 If installed make sure at least 9.5.0
// 1.1.1.1 If not, ask to upgrade or abort task
// 1.1.1.2 Upgrade to latest
// 1.1.2 Check if a eslint.config.js is defined
// 1.1.2.1 If defined ask to overwrite
// 1.1.2.2 If no, abort task,
// 1.1.2.2 If yes ask which to install
// 1.1.2.3 Add script to package.json
// 1.1.3 Check if a eslint.config.style.js is defined
// 1.1.3.1 If defined ask to overwrite
// 1.1.3.2 If no, abort task,
// 1.1.3.2 If yes ask which to install
// 1.1.3.3 Add script to package.json


//Husky


//Lint Stages


// Commit Lint

// Semantic Release Notes


//Knip

