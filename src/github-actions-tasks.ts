import { writeConfigFile } from "./utils.ts";

// GitHub Actions workflow file contents
const CACHE_WORKFLOW = `name: ESLint Auto-fix and Check

on:
  push:
    branches:
      - main

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  eslint:
    runs-on: ubuntu-latest

    steps:

      # 0. Stop infinite loop
      - name: Check if commit is made by bot
        if: github.actor == 'github-actions[bot]'
        run: echo "Commit made by bot. Exiting workflow." && exit 0

      # 1. Checkout the repository with credentials persisted for push
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0
          ref: \${{ github.head_ref }}

      # 2. Set up pnpm
      - uses: pnpm/action-setup@v4
        with:
          version: 9

      # 2.1. Cache pnpm store
      - name: Get pnpm store
        id: pnpm-cache-store
        run: echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT

      # 2.2. Cache pnpm store
      - name: Cache pnpm store
        uses: actions/cache@v3
        with:
          path: \${{ steps.pnpm-cache-store.outputs.STORE_PATH }}
          key: \${{ runner.os }}-pnpm-\${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            \${{ runner.os }}-pnpm-

      # 4. Install dependencies using pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
`;

const CI_TEST_WORKFLOW = `name: Dummy CI

on:
  pull_request:
  push:

jobs:
  ci_tests:
    runs-on: ubuntu-latest
    name: ci tests
    steps:
      - run: echo "CI passed"
`;

const LINT_WORKFLOW = `name: ESLint Auto-fix and Check

on:
  pull_request:
    branches:
      - main
      - 'release-*'
    types: [ opened, synchronize, reopened ]
  push:
    branches:
      - 'release-*'

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  eslint:
    runs-on: ubuntu-latest

    steps:

      # 0. Stop infinite loop
      - name: Check if commit is made by bot
        if: github.actor == 'github-actions[bot]'
        run: echo "Commit made by bot. Exiting workflow." && exit 0

      # 1. Checkout the repository with credentials persisted for push
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0
          ref: \${{ github.head_ref }}

      # 2. Set up pnpm
      - uses: pnpm/action-setup@v4
        with:
          version: 9

      # 2.1. Cache pnpm store
      - name: Get pnpm store
        id: pnpm-cache-store
        run: echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT

      # 2.2. Cache pnpm store
      - name: Cache pnpm store
        uses: actions/cache@v3
        with:
          path: \${{ steps.pnpm-cache-store.outputs.STORE_PATH }}
          key: \${{ runner.os }}-pnpm-\${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            \${{ runner.os }}-pnpm-

      # 3. Set up Node.js
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      # 4. Install dependencies using pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # 5. Run ESLint with --fix and check for errors in one step
      - name: Run ESLint --fix and Check for Errors
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          # Disable immediate exit on error
          set +e

          # Run ESLint with --fix

          pnpm run lint:fix
          FIX_EXIT_CODE=$?

          # Configure Git
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

          # Commit and push fixes if any changes were made
          if [[ \`git status --porcelain\` ]]; then
            git add .
            git commit -m "chore: Apply ESLint fixes [skip ci]" --no-verify
            git push origin HEAD:\${{ github.head_ref }}
          fi

          if [ $FIX_EXIT_CODE -ne 0 ]; then
            echo "ESLint checks failed. FIX_EXIT_CODE=$FIX_EXIT_CODE"
            exit 1
          fi
`;

const KNIP_WORKFLOW = `name: Knip

on:
  pull_request:
    branches:
      - main
      - 'release-*'
    types: [ opened, synchronize, reopened ]
  push:
    branches:
      - 'release-*'

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  knip:
    runs-on: ubuntu-latest

    steps:

      # 0. Stop infinite loop
      - name: Check if commit is made by bot
        if: github.actor == 'github-actions[bot]'
        run: echo "Commit made by bot. Exiting workflow." && exit 0

      # 1. Checkout the repository with credentials persisted for push
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0
          ref: \${{ github.head_ref }}

      # 2. Set up pnpm
      - uses: pnpm/action-setup@v4
        with:
          version: 9

      # 2.1. Cache pnpm store
      - name: Get pnpm store
        id: pnpm-cache-store
        run: echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT

      # 2.2. Cache pnpm store
      - name: Cache pnpm store
        uses: actions/cache@v3
        with:
          path: \${{ steps.pnpm-cache-store.outputs.STORE_PATH }}
          key: \${{ runner.os }}-pnpm-\${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            \${{ runner.os }}-pnpm-

      # 3. Set up Node.js
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      # 4. Install dependencies using pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # 5. Run Knip
      - name: Run knip
        run: pnpm knip
`;

const TS_CHECK_WORKFLOW = `name: TS Check

on:
  pull_request:
    branches:
      - main
      - 'release-*'
    types: [ opened, synchronize, reopened ]
  push:
    branches:
      - 'release-*'

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  tscheck:
    runs-on: ubuntu-latest

    steps:

      # 0. Stop infinite loop
      - name: Check if commit is made by bot
        if: github.actor == 'github-actions[bot]'
        run: echo "Commit made by bot. Exiting workflow." && exit 0

      # 1. Checkout the repository with credentials persisted for push
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0
          ref: \${{ github.head_ref }}

      # 2. Set up pnpm
      - uses: pnpm/action-setup@v4
        with:
          version: 9

      # 2.1. Cache pnpm store
      - name: Get pnpm store
        id: pnpm-cache-store
        run: echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT

      # 2.2. Cache pnpm store
      - name: Cache pnpm store
        uses: actions/cache@v3
        with:
          path: \${{ steps.pnpm-cache-store.outputs.STORE_PATH }}
          key: \${{ runner.os }}-pnpm-\${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            \${{ runner.os }}-pnpm-

      # 3. Set up Node.js
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      # 4. Install dependencies using pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # 5. Run TS check
      - name: Run TypeScript Check
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: pnpm run lint:ts
`;

export type GithubActionsOptions = {
  includeCache?: boolean;
  includeCiTest?: boolean;
  includeLint?: boolean;
  includeKnip?: boolean;
  includeTsCheck?: boolean;
};

export function createGithubActionsTasks(options: GithubActionsOptions) {
  const tasks: Array<{ title: string; task: ReturnType<typeof writeConfigFile>; }> = [];

  // Always include cache and ci_test
  if (options.includeCache !== false) {
    tasks.push({
      title: "Setting up cache workflow",
      task: writeConfigFile(".github/workflows/cache.yml", CACHE_WORKFLOW),
    });
  }

  if (options.includeCiTest !== false) {
    tasks.push({
      title: "Setting up CI test workflow",
      task: writeConfigFile(".github/workflows/ci_test.yml", CI_TEST_WORKFLOW),
    });
  }

  // Conditional workflows
  if (options.includeLint) {
    tasks.push({
      title: "Setting up ESLint workflow",
      task: writeConfigFile(".github/workflows/lint.yml", LINT_WORKFLOW),
    });
  }

  if (options.includeKnip) {
    tasks.push({
      title: "Setting up Knip workflow",
      task: writeConfigFile(".github/workflows/knip.yml", KNIP_WORKFLOW),
    });
  }

  if (options.includeTsCheck) {
    tasks.push({
      title: "Setting up TypeScript check workflow",
      task: writeConfigFile(".github/workflows/ts-check.yml", TS_CHECK_WORKFLOW),
    });
  }

  return tasks;
}

export const githubActionsTasks = createGithubActionsTasks({
  includeCache: true,
  includeCiTest: true,
});
