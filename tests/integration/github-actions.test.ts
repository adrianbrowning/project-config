/**
 * GitHub Actions integration tests: generated workflows are parsed and checked structurally
 */

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";
import { TestProject } from "../utils/test-project.ts";

type Step = { if?: string; name?: string; permissions?: unknown; run?: string; uses?: string; with?: Record<string, unknown>; };
type Job = { if?: string; needs?: Array<string> | string; outputs?: Record<string, string>; permissions?: Record<string, string>; steps: Array<Step>; };
type Workflow = {
  concurrency?: { "cancel-in-progress"?: boolean; group?: string; };
  jobs: Partial<Record<string, Job>>;
  on: Record<string, null | { branches?: Array<string>; }>;
  permissions?: Record<string, string>;
};
type CompositeAction = { runs: { steps: Array<Step>; using: string; }; };

const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../../github_actions_examples");

// Every --tool=githubActions run installs the review skill with `pnpm dlx skills add`; set GCM_OFFLINE=1 to skip the test that checks it
const offline = process.env.GCM_OFFLINE === "1";

/** Parses a generated workflow; invalid YAML throws and fails the test */
function readWorkflow(project: TestProject, file: string): Workflow {
  const workflow: Workflow = YAML.parse(project.readFile(`.github/workflows/${file}`));
  return workflow;
}

function job(workflow: Workflow, name: string): Job {
  const found = workflow.jobs[name];
  if (!found) throw new Error(`No "${name}" job; jobs are: ${Object.keys(workflow.jobs).join(", ")}`);
  return found;
}

describe("GitHub Actions workflows with ts, eslint and knip selected", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "github-actions-all" });
    project.runCli([ "--tool=ts", "--tool=eslint", "--tool=knip", "--tool=githubActions", "--yes", "--ts-no-dom", "--ts-type=library" ]);
  });
  afterAll(() => project.cleanup());

  it.each([
    [ "ci_test.yml", "test-runner", "pnpm run test" ],
    [ "lint.yml", "eslint", "pnpm run lint:s" ],
    [ "knip.yml", "knip", "pnpm knip" ],
    [ "ts-check.yml", "tscheck", "pnpm run lint:ts" ],
  ])("%s: job %s runs on pull requests, checks out, runs the setup action, then `%s`", (file, jobName, command) => {
    const workflow = readWorkflow(project, file);
    expect(Object.keys(workflow.jobs)).toEqual([ jobName ]);
    expect(workflow.on).toHaveProperty("pull_request");

    const { permissions, steps } = job(workflow, jobName);
    expect(permissions?.contents).toBe("read");
    expect(steps[0]?.uses).toMatch(/^actions\/checkout@v\d+$/);
    expect(steps[1]?.uses).toBe("./.github/actions/setup");
    expect(steps.map(step => step.run ?? "").join("\n")).toContain(command);
  });

  it("cancels superseded lint, knip and ts-check runs", () => {
    for (const file of [ "lint.yml", "knip.yml", "ts-check.yml" ]) {
      expect(readWorkflow(project, file).concurrency?.["cancel-in-progress"], file).toBe(true);
    }
  });

  it("the setup action is a composite that skips bot commits and installs pnpm and Node", () => {
    const action: CompositeAction = YAML.parse(project.readFile(".github/actions/setup/action.yml"));
    expect(action.runs.using).toBe("composite");
    expect(action.runs.steps[0]?.if).toBe("github.actor == 'github-actions[bot]'");
    const uses = action.runs.steps.map(step => step.uses?.replace(/@.*/, ""));
    expect(uses).toEqual(expect.arrayContaining([ "actions/checkout", "pnpm/action-setup", "actions/setup-node", "actions/cache" ]));
  });

  it("uses the Anthropic API runner for the Claude review by default", () => {
    const review = job(readWorkflow(project, "claude-pr-review.yml"), "review");
    const claude = review.steps.find(step => step.uses?.startsWith("anthropics/claude-code-action@"));
    expect(claude?.with).toHaveProperty("anthropic_api_key");
    expect(claude?.with).not.toHaveProperty("use_bedrock");
  });

  it("writes workflows verbatim from github_actions_examples", () => {
    for (const file of [ "ci_test.yml", "lint.yml", "knip.yml", "ts-check.yml", "claude-pr-review.yml" ]) {
      expect(project.readFile(`.github/workflows/${file}`)).toBe(fs.readFileSync(path.join(EXAMPLES_DIR, file), "utf-8"));
    }
  });
});

describe("GitHub Actions workflows with no other tools", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "github-actions-only" });
    project.runCli([ "--tool=githubActions", "--yes" ]);
  });
  afterAll(() => project.cleanup());

  it("writes ci_test and the Claude review, and no lint, knip or ts-check workflow", () => {
    expect(fs.readdirSync(path.join(project.dir, ".github/workflows")).toSorted((a, b) => a.localeCompare(b)))
      .toEqual([ "ci_test.yml", "claude-pr-review.yml" ]);
    expect(Object.keys(readWorkflow(project, "ci_test.yml").jobs)).toEqual([ "test-runner" ]);
  });

  it.skipIf(offline)("installs the cc-pr-review-ci skill from agent-skills", () => {
    expect(project.fileExists(".claude/skills/cc-pr-review-ci/SKILL.md")).toBe(true);
  });
});

describe("Claude review with --claude-runner=bedrock", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "github-actions-bedrock" });
    project.runCli([ "--tool=githubActions", "--yes", "--claude-runner=bedrock" ]);
  });
  afterAll(() => project.cleanup());

  it("writes the Bedrock template verbatim", () => {
    expect(project.readFile(".github/workflows/claude-pr-review.yml"))
      .toBe(fs.readFileSync(path.join(EXAMPLES_DIR, "claude-pr-review-bedrock.yml"), "utf-8"));
  });

  it("runs the agent read-only and posts from a separate job that holds pull-requests: write", () => {
    const workflow = readWorkflow(project, "claude-pr-review.yml");
    expect(Object.keys(workflow.jobs)).toEqual([ "review", "post" ]);

    const review = job(workflow, "review");
    const post = job(workflow, "post");
    expect(review.permissions).toEqual({ "contents": "read", "pull-requests": "read" });
    expect(post.permissions).toEqual({ "contents": "read", "pull-requests": "write" });
    expect(post.needs).toBe("review");
    expect(post.if).toContain("needs.review.outputs.pr_number");

    // GitHub rejects step-level permissions; track_progress would need write access in the review job
    for (const step of [ ...review.steps, ...post.steps ]) expect(step, step.name).not.toHaveProperty("permissions");
    const claude = review.steps.find(step => step.uses?.startsWith("anthropics/claude-code-action@"));
    expect(claude?.with).toMatchObject({ use_bedrock: true });
    expect(claude?.with).not.toHaveProperty("track_progress");

    // review.json crosses jobs as an artifact
    const upload = review.steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
    const download = post.steps.find(step => step.uses?.startsWith("actions/download-artifact@"));
    expect(download?.with?.name).toBe(upload?.with?.name);
  });
});

describe("GitHub Actions in a pnpm workspace", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "github-actions-workspace" });
    project.runCli([ "--tool=workspace", "--tool=githubActions", "--yes" ]);
  });
  afterAll(() => project.cleanup());

  it("writes one root CI workflow instead of the single-package ones", () => {
    expect(fs.readdirSync(path.join(project.dir, ".github/workflows")).toSorted((a, b) => a.localeCompare(b)))
      .toEqual([ "ci.yml", "claude-pr-review.yml" ]);
    expect(project.readFile(".github/workflows/ci.yml")).toBe(fs.readFileSync(path.join(EXAMPLES_DIR, "workspace-ci.yml"), "utf-8"));
  });

  it("runs on PRs and pushes to main, read-only, cancelling superseded runs", () => {
    const workflow = readWorkflow(project, "ci.yml");
    expect(workflow.on).toEqual({ pull_request: { branches: [ "main" ] }, push: { branches: [ "main" ] } });
    expect(workflow.concurrency).toEqual({ "group": "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}", "cancel-in-progress": true });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job(workflow, "check").permissions).toEqual({ contents: "read" });
  });

  it("installs once through the setup action, then runs every root check", () => {
    const { steps } = job(readWorkflow(project, "ci.yml"), "check");
    expect(steps.map(step => step.uses ?? step.run)).toEqual([
      "actions/checkout@v7",
      "./.github/actions/setup",
      "pnpm lint",
      "pnpm lint:ts",
      "pnpm test",
      "pnpm build",
    ]);

    // The setup action installs at the root from the lockfile and keys the pnpm store cache on it
    const action: CompositeAction = YAML.parse(project.readFile(".github/actions/setup/action.yml"));
    expect(action.runs.steps.map(step => step.run)).toContain("pnpm install --frozen-lockfile");
    expect(action.runs.steps.find(step => step.uses?.startsWith("actions/cache@"))?.with?.key).toContain("hashFiles('**/pnpm-lock.yaml')");
  });

  it("treats an existing workspace the same when only githubActions is selected", () => {
    using existing = new TestProject({ name: "github-actions-existing-workspace" });
    existing.writeFile("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
    existing.runCli([ "--tool=githubActions", "--yes" ]);
    expect(existing.fileExists(".github/workflows/ci.yml")).toBe(true);
    expect(existing.fileExists(".github/workflows/ci_test.yml")).toBe(false);
  });
});
