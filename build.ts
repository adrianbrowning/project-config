import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import esbuild from "esbuild";
import type { PackageJson } from "knip/dist/types/package-json.js";
import type { YES_ANY_IS_OK_HERE } from "./src/types.ts";

// Read package.json to extract versions from peerDependencies
const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf-8")) as PackageJson;
const peerDeps = packageJson.peerDependencies || {};

// Build version replacement map
const versionReplacements = {
  "__eslint_version__": peerDeps.eslint || "^9.8.0",
  "__commitlint_version__": peerDeps["@commitlint/cli"] || "20.0.0",
  "__husky_version__": peerDeps.husky || "9.0.6",
  "__knip_version__": peerDeps.knip || "5.70.1",
  "__lintstaged_version__": peerDeps["lint-staged"] || "15.2.10",
  "__semanticrelease_version__": peerDeps["semantic-release-unsquash"] || "0.4.0",
  "__jscpd_version__": peerDeps.jscpd || "^4.0.9",
  "__ts_version__": "",
};

// Extract the imports object
const importMap = (packageJson.imports || {}) as Record<string, string>;

// Configure esbuild to use path aliases based on the imports map
const aliasPlugins = Object.keys(importMap).map(alias => ({
  name: "alias-plugin",
  setup(build: YES_ANY_IS_OK_HERE) {
    build.onResolve({ filter: new RegExp(`^${alias}/`) }, (args: { path: string; }) => {
      const aliasPath = importMap[alias]!;
      const resolvedPath = path.resolve(aliasPath, args.path.slice(alias.length));
      return { path: resolvedPath };
    });
  },
}));

// Build the main setup.cjs
// Use CommonJS format to avoid issues with enquirer's dynamic require() calls
// Use .cjs extension because package.json has "type": "module"
const setupBuild = esbuild.build({
  entryPoints: [ "src/setup.ts" ],
  bundle: true,
  outfile: "dist/setup.cjs",
  platform: "node",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  plugins: [ ...aliasPlugins ],
});

// Build ESLint configs (.ts to .js) - bundle to inline local imports
const eslintBuild = esbuild.build({
  entryPoints: [ "./src/eslint.ts", "./src/eslint.styled.ts" ],
  outdir: "dist",
  platform: "node",
  bundle: true,
  packages: "external",
  format: "esm",
  minifySyntax: false, // Preserve exact syntax including operator precedence
  minifyWhitespace: false,
  minifyIdentifiers: false,
});

// Map github_actions_examples/*.yml filenames to their placeholder names
const ghaWorkflows: Record<string, string> = {
  "cache.yml": "CACHE_WORKFLOW",
  "ci_test.yml": "CI_TEST_WORKFLOW",
  "lint.yml": "LINT_WORKFLOW",
  "knip.yml": "KNIP_WORKFLOW",
  "ts-check.yml": "TS_CHECK_WORKFLOW",
  "claude-pr-review.yml": "CLAUDE_PR_REVIEW_WORKFLOW",
  "release.yml": "RELEASE_WORKFLOW",
};

// Map cc-pr-review-ci skill files to their placeholder names
const ccPrReviewCiSkillFiles: Record<string, string> = {
  "SKILL.md": "CC_PR_REVIEW_CI_SKILL_MD",
  "references/devops.md": "CC_PR_REVIEW_CI_REF_DEVOPS",
  "references/duplication.md": "CC_PR_REVIEW_CI_REF_DUPLICATION",
  "references/format.md": "CC_PR_REVIEW_CI_REF_FORMAT",
  "references/holistic.md": "CC_PR_REVIEW_CI_REF_HOLISTIC",
  "references/performance.md": "CC_PR_REVIEW_CI_REF_PERFORMANCE",
  "references/react-ts.md": "CC_PR_REVIEW_CI_REF_REACT_TS",
  "references/security.md": "CC_PR_REVIEW_CI_REF_SECURITY",
  "references/testing.md": "CC_PR_REVIEW_CI_REF_TESTING",
};

Promise.all([ setupBuild, eslintBuild ]).then(() => {
  // Replace version placeholders in the bundled output
  let setupContent = fs.readFileSync("dist/setup.cjs", "utf8");
  for (const [ placeholder, replacement ] of Object.entries(versionReplacements)) {
    setupContent = setupContent.replace(
      new RegExp(placeholder, "g"),
      replacement
    );
  }

  // Replace GHA workflow placeholders with file contents from github_actions_examples/
  const examplesDir = path.resolve("github_actions_examples");
  for (const [ filename, constName ] of Object.entries(ghaWorkflows)) {
    const ymlPath = path.join(examplesDir, filename);
    if (!fs.existsSync(ymlPath)) continue;
    const ymlContent = fs.readFileSync(ymlPath, "utf-8");
    setupContent = setupContent.replace(`"__${constName}__"`, () => JSON.stringify(ymlContent));
  }

  // Replace cc-pr-review-ci skill file placeholders
  const skillDir = path.resolve(".claude/skills/cc-pr-review-ci");
  for (const [ filename, constName ] of Object.entries(ccPrReviewCiSkillFiles)) {
    const filePath = path.join(skillDir, filename);
    if (!fs.existsSync(filePath)) continue;
    const fileContent = fs.readFileSync(filePath, "utf-8");
    setupContent = setupContent.replace(`"__${constName}__"`, () => JSON.stringify(fileContent));
  }

  fs.writeFileSync("dist/setup.cjs", setupContent);

  // Generate type declaration files for ESLint configs
  fs.writeFileSync("dist/eslint.d.ts", `import type { Linter } from 'eslint';

export declare const nodeRules: Array<Linter.Config>;
export declare const config: Array<Linter.Config>;
export default config;
`);
  fs.writeFileSync("dist/eslint.styled.d.ts", `import type { Linter } from 'eslint';

export declare const config: Array<Linter.Config>;
export default config;
`);

  // Make the file executable
  execSync("chmod +x dist/setup.cjs"); // eslint-disable-line sonarjs/no-os-command-from-path
  console.log("✓ Build complete");
  return null;
})
  .catch(err => {
    console.error("Build failed:", err);
    process.exit(1);
  });
