/**
 * CommitLint integration tests
 */

import {describe, it, expect, beforeAll, beforeEach} from "vitest";
import {
    assertFileExists,
    assertFileContains
} from "../utils/file-assertions.ts";
import {TestProject} from "../utils/test-project.ts";

describe("CommitLint Configuration", () => {
    let project: TestProject;
    beforeAll(() => {
        project = new TestProject({name: "commit-lint-config"});
    });

    it("generates commitlint.config.js with conventional config", () => {
        project.runCli(["--tool=commitLint", "--yes"]);

        assertFileExists(project, "commitlint.config.js");
        assertFileContains(project, "commitlint.config.js", "@commitlint/config-conventional");
    });

    it("has subject-case rule configured", () => {
        project.runCli(["--tool=commitLint", "--yes"]);

        assertFileContains(project, "commitlint.config.js", "subject-case");
        assertFileContains(project, "commitlint.config.js", "sentence-case");
        assertFileContains(project, "commitlint.config.js", "lower-case");
    });

    describe("commit messages", () => {
        let counter = 1;
        beforeAll(() => {
            project.rmDir(".husky");
            project.runCli(["--tool=husky", "--tool=commitLint", "--yes"]);
        });
        beforeEach(() => {
            project.writeFile("src/index.ts", `export const x = ${counter++};`);
        })
        it("rejects non-conventional commit message", () => {
            // Invalid commit message should be rejected

            const result = project.gitCommit("bad commit message", {expectFailure: true});
            expect(result.exitCode).not.toBe(0);
        });

        it("accepts feat: conventional commit", () => {
            // Valid commit should succeed
            const result = project.gitCommit("feat: add new feature");
            expect(result.exitCode).toBe(0);
        });

        it("accepts fix: conventional commit", () => {
            const result = project.gitCommit("fix: resolve bug");
            expect(result.exitCode).toBe(0);
        });

        it("accepts chore: conventional commit", () => {
            const result = project.gitCommit( "chore: update dependencies");
            expect(result.exitCode).toBe(0);
        });
    })


});
