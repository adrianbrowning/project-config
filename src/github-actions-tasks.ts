import { execSync } from "node:child_process";
import type { ListrTask } from "listr2";
import type { TaskContext } from "./cli-args.ts";
import { writeConfigFile } from "./utils.ts";

// GitHub Actions workflow file contents — replaced at build time from github_actions_examples/
export const SETUP_ACTION = "__SETUP_ACTION__";
export const SETUP_ACTION_PATH = ".github/actions/setup/action.yml";
export const CI_TEST_WORKFLOW = "__CI_TEST_WORKFLOW__";
const WORKSPACE_CI_WORKFLOW = "__WORKSPACE_CI_WORKFLOW__";
export const LINT_WORKFLOW = "__LINT_WORKFLOW__";
export const KNIP_WORKFLOW = "__KNIP_WORKFLOW__";
export const TS_CHECK_WORKFLOW = "__TS_CHECK_WORKFLOW__";
export const CLAUDE_PR_REVIEW_WORKFLOW = "__CLAUDE_PR_REVIEW_WORKFLOW__";
export const CLAUDE_PR_REVIEW_BEDROCK_WORKFLOW = "__CLAUDE_PR_REVIEW_BEDROCK_WORKFLOW__";

export type ClaudeRunnerType = "anthropic" | "bedrock";

export type GithubActionsOptions = {
  claudeRunnerType?: ClaudeRunnerType;
  includeCiTest?: boolean;
  includeClaudePrReview?: boolean;
  includeKnip?: boolean;
  includeLint?: boolean;
  includeTsCheck?: boolean;
  /** pnpm workspace: one root CI workflow (lint, type-check, test, build) replaces ci_test, lint and ts-check. */
  workspace?: boolean;
};

export function createGithubActionsTasks(options: GithubActionsOptions) {
  const tasks: Array<Pick<ListrTask<TaskContext>, "task" | "title">> = [];

  // Always install the reusable setup action
  tasks.push({
    title: "Setting up reusable setup action",
    task: writeConfigFile(SETUP_ACTION_PATH, SETUP_ACTION),
  });

  if (options.workspace) {
    tasks.push({
      title: "Setting up workspace CI workflow",
      task: writeConfigFile(".github/workflows/ci.yml", WORKSPACE_CI_WORKFLOW),
    });
  }
  else {
    if (options.includeCiTest !== false) {
      tasks.push({
        title: "Setting up CI test workflow",
        task: writeConfigFile(".github/workflows/ci_test.yml", CI_TEST_WORKFLOW),
      });
    }

    if (options.includeLint) {
      tasks.push({
        title: "Setting up ESLint workflow",
        task: writeConfigFile(".github/workflows/lint.yml", LINT_WORKFLOW),
      });
    }

    if (options.includeTsCheck) {
      tasks.push({
        title: "Setting up TypeScript check workflow",
        task: writeConfigFile(".github/workflows/ts-check.yml", TS_CHECK_WORKFLOW),
      });
    }
  }

  if (options.includeKnip) {
    tasks.push({
      title: "Setting up Knip workflow",
      task: writeConfigFile(".github/workflows/knip.yml", KNIP_WORKFLOW),
    });
  }

  if (options.includeClaudePrReview) {
    const workflowContent = options.claudeRunnerType === "bedrock"
      ? CLAUDE_PR_REVIEW_BEDROCK_WORKFLOW
      : CLAUDE_PR_REVIEW_WORKFLOW;
    tasks.push({
      title: "Setting up Claude PR review workflow",
      task: writeConfigFile(".github/workflows/claude-pr-review.yml", workflowContent),
    });
    tasks.push({
      title: "Installing cc-pr-review-ci skill from adrianbrowning/agent-skills",
      task: async () => {
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        execSync("pnpm dlx skills add adrianbrowning/agent-skills --skill cc-pr-review-ci -a claude-code --copy -y", { stdio: "inherit" });
      },
    });
  }

  return tasks;
}

export const githubActionsTasks = createGithubActionsTasks({
  includeCiTest: true,
});
