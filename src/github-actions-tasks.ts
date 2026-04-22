import { writeConfigFile } from "./utils.ts";

// GitHub Actions workflow file contents — replaced at build time from github_actions_examples/
const CACHE_WORKFLOW = "__CACHE_WORKFLOW__";
const CI_TEST_WORKFLOW = "__CI_TEST_WORKFLOW__";
const LINT_WORKFLOW = "__LINT_WORKFLOW__";
const KNIP_WORKFLOW = "__KNIP_WORKFLOW__";
const TS_CHECK_WORKFLOW = "__TS_CHECK_WORKFLOW__";
const CLAUDE_PR_REVIEW_WORKFLOW = "__CLAUDE_PR_REVIEW_WORKFLOW__";
const RELEASE_WORKFLOW = "__RELEASE_WORKFLOW__";

// Claude PR Review CI skill files — replaced at build time from .claude/skills/cc-pr-review-ci/
const CC_PR_REVIEW_CI_SKILL_MD = "__CC_PR_REVIEW_CI_SKILL_MD__";
const CC_PR_REVIEW_CI_REF_DEVOPS = "__CC_PR_REVIEW_CI_REF_DEVOPS__";
const CC_PR_REVIEW_CI_REF_DUPLICATION = "__CC_PR_REVIEW_CI_REF_DUPLICATION__";
const CC_PR_REVIEW_CI_REF_FORMAT = "__CC_PR_REVIEW_CI_REF_FORMAT__";
const CC_PR_REVIEW_CI_REF_HOLISTIC = "__CC_PR_REVIEW_CI_REF_HOLISTIC__";
const CC_PR_REVIEW_CI_REF_PERFORMANCE = "__CC_PR_REVIEW_CI_REF_PERFORMANCE__";
const CC_PR_REVIEW_CI_REF_REACT_TS = "__CC_PR_REVIEW_CI_REF_REACT_TS__";
const CC_PR_REVIEW_CI_REF_SECURITY = "__CC_PR_REVIEW_CI_REF_SECURITY__";
const CC_PR_REVIEW_CI_REF_TESTING = "__CC_PR_REVIEW_CI_REF_TESTING__";

export type GithubActionsOptions = {
  includeCache?: boolean;
  includeCiTest?: boolean;
  includeLint?: boolean;
  includeKnip?: boolean;
  includeTsCheck?: boolean;
  includeClaudePrReview?: boolean;
  includeRelease?: boolean;
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

  if (options.includeClaudePrReview) {
    tasks.push({
      title: "Setting up Claude PR review workflow",
      task: writeConfigFile(".github/workflows/claude-pr-review.yml", CLAUDE_PR_REVIEW_WORKFLOW),
    });
    tasks.push({
      title: "Setting up cc-pr-review-ci skill",
      task: writeConfigFile(".claude/skills/cc-pr-review-ci/SKILL.md", CC_PR_REVIEW_CI_SKILL_MD),
    });
    tasks.push({
      title: "Setting up cc-pr-review-ci skill reference: devops",
      task: writeConfigFile(".claude/skills/cc-pr-review-ci/references/devops.md", CC_PR_REVIEW_CI_REF_DEVOPS),
    });
    tasks.push({
      title: "Setting up cc-pr-review-ci skill reference: duplication",
      task: writeConfigFile(".claude/skills/cc-pr-review-ci/references/duplication.md", CC_PR_REVIEW_CI_REF_DUPLICATION),
    });
    tasks.push({
      title: "Setting up cc-pr-review-ci skill reference: format",
      task: writeConfigFile(".claude/skills/cc-pr-review-ci/references/format.md", CC_PR_REVIEW_CI_REF_FORMAT),
    });
    tasks.push({
      title: "Setting up cc-pr-review-ci skill reference: holistic",
      task: writeConfigFile(".claude/skills/cc-pr-review-ci/references/holistic.md", CC_PR_REVIEW_CI_REF_HOLISTIC),
    });
    tasks.push({
      title: "Setting up cc-pr-review-ci skill reference: performance",
      task: writeConfigFile(".claude/skills/cc-pr-review-ci/references/performance.md", CC_PR_REVIEW_CI_REF_PERFORMANCE),
    });
    tasks.push({
      title: "Setting up cc-pr-review-ci skill reference: react-ts",
      task: writeConfigFile(".claude/skills/cc-pr-review-ci/references/react-ts.md", CC_PR_REVIEW_CI_REF_REACT_TS),
    });
    tasks.push({
      title: "Setting up cc-pr-review-ci skill reference: security",
      task: writeConfigFile(".claude/skills/cc-pr-review-ci/references/security.md", CC_PR_REVIEW_CI_REF_SECURITY),
    });
    tasks.push({
      title: "Setting up cc-pr-review-ci skill reference: testing",
      task: writeConfigFile(".claude/skills/cc-pr-review-ci/references/testing.md", CC_PR_REVIEW_CI_REF_TESTING),
    });
  }

  if (options.includeRelease) {
    tasks.push({
      title: "Setting up release workflow",
      task: writeConfigFile(".github/workflows/release.yml", RELEASE_WORKFLOW),
    });
  }

  return tasks;
}

export const githubActionsTasks = createGithubActionsTasks({
  includeCache: true,
  includeCiTest: true,
});
