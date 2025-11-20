import * as enquirer from 'enquirer';
import { Listr} from 'listr2'
import {detectPackageManager} from "./utils.ts";
import {tsTasks} from "./ts-tasks.ts";
import {esLintTasks} from "./eslint-tasks.ts";
import {huskyTasks} from "./husky-tasks.ts";
import {commitLintTasks} from "./convential-tasks.ts";
import {lintstagedTasks} from "./lintstaged-tasks.ts";
import {semanticReleaseNotesTasks} from "./sematic-release-tasks.ts";
import {knipTasks} from "./knip-tasks.ts";

const {MultiSelect} = enquirer.default as any;

const tools = [
    {name: 'TS', value: 'ts'},
    {name: 'ESLint', value: 'eslint'},
    {name: 'Husky', value: 'husky'},
    {name: 'CommitLint', value: 'commitLint'},
    {name: 'Lint-Staged', value: 'lintStaged'},
    {name: 'Semantic Release Notes', value: 'semanticReleaseNotes'},
    {name: 'Knip', value: 'knip'}
]
const enable = (choices: any, fn: any) => choices.forEach((ch: any) => (ch.enabled = fn(ch)));
const prompt = new MultiSelect({
    name: 'tool',
    message: 'Please select what to install',
    hint: '(Use <space> to select, <return> to submit)',
    choices: [
        {name: 'All', value: 'all',
            onChoice(state: any, choice: any, i: number) {
                if (state.index === i && choice.enabled) {
                    enable(state.choices, (ch: any) => ch.name !== 'none');
                }
            }
        },
        ...tools,
    ],
    result(names: any) {
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
            task: async (ctx: any, task: any) => {
                ctx.packageManager = await detectPackageManager(task);
            }
        },
    ],

    {
        concurrent: false,
    }
)

prompt.run()
    .then((answer: any) => {
        console.log(answer);
        if (answer.length === 0) {
            console.log("Nothing to do.")
            return;
        }
        if (answer.includes("ts")) tasks.add({
            title: "TypeScript",
            task: async (_ctx: any, task: any) => {
                return task.newListr(tsTasks, {concurrent: false });
            }
        });
        if (answer.includes("eslint")) tasks.add({
            title: "ESLint",
            task: async (_ctx: any, task: any) => {
                return task.newListr(esLintTasks, {concurrent: false });
            }
        });
        if (answer.includes("husky")) tasks.add({
            title: "Husky",
            task: async (_ctx: any, task: any) => {
                return task.newListr(huskyTasks, {concurrent: false });
            }
        });
        if (answer.includes("commitLint")) tasks.add({
            title: "CommitLint",
            task: async (_ctx: any, task: any) => {
                return task.newListr(commitLintTasks, {concurrent: false });
            }
        });
        if (answer.includes("lintStaged")) tasks.add({
            title: "LintStaged",
            task: async (_ctx: any, task: any) => {
                return task.newListr(lintstagedTasks, {concurrent: false });
            }
        });
        if (answer.includes("semanticReleaseNotes")) tasks.add({
            title: "Semantic Release Notes",
            task: async (_ctx: any, task: any) => {
                return task.newListr(semanticReleaseNotesTasks, {concurrent: false });
            }
        });
        if (answer.includes("knip")) tasks.add({
            title: "Knip",
            task: async (_ctx: any, task: any) => {
                return task.newListr(knipTasks, {concurrent: false });
            }
        });

        return tasks.run()
    })
    .catch(console.error);


// Define file contents

// Install dependencies

/*

function stuff() {

    const files = {
        'eslint.config.style.ts': `
import type { Linter } from "eslint";
import { config as defaultConfig } from '@gingacodemonkey/config/styled';

const config: Linter.Config[] = [...defaultConfig];

export default config;
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
            '*.{js,ts,tsx}': ['eslint --config eslint.config.style.ts --fix --max-warnings=0 --cache']
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
                        "assets": "dist/!*.tgz"
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


    function ensureDir(dir: string) {
        try {
            fs.mkdirSync(dir, {recursive: true});
        } catch (err: any) {
            if (err.code !== 'EEXIST') throw err
        }
    }

    function writeToFile(path: string, data: string) {
        const {dir} = Path.parse(path);
        ensureDir(dir);
        fs.writeFileSync(path, data, {encoding: 'utf8'});

    }

}
*/



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
// 1.1.2 Check if a eslint.config.ts is defined
// 1.1.2.1 If defined ask to overwrite
// 1.1.2.2 If no, abort task,
// 1.1.2.2 If yes ask which to install
// 1.1.2.3 Add script to package.json
// 1.1.3 Check if a eslint.config.style.ts is defined
// 1.1.3.1 If defined ask to overwrite
// 1.1.3.2 If no, abort task,
// 1.1.3.2 If yes ask which to install
// 1.1.3.3 Add script to package.json


//Husky


//Lint Stages


// Commit Lint

// Semantic Release Notes


//Knip
