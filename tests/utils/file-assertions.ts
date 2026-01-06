/**
 * Custom file assertions for testing
 */

import { expect } from "vitest";
import type { TestProject } from "./test-project.ts";

/**
 * Assert that a file exists in the project
 */
export function assertFileExists(project: TestProject, filePath: string): void {
  expect(project.fileExists(filePath), `Expected ${filePath} to exist`).toBe(true);
}

/**
 * Assert that a file does NOT exist in the project
 */
export function assertFileNotExists(project: TestProject, filePath: string): void {
  expect(project.fileExists(filePath), `Expected ${filePath} to NOT exist`).toBe(false);
}

/**
 * Assert that a file contains specific content
 */
export function assertFileContains(project: TestProject, filePath: string, content: string): void {
  const fileContent = project.readFile(filePath);
  expect(fileContent).toContain(content);
}


/**
 * Assert that a JSON file has a property at a given path
 */
export function assertJsonHasProperty<T>(
  project: TestProject,
  filePath: string,
  propertyPath: string,
  expectedValue?: T
): void {
  const json = project.readJson(filePath);
  const keys = propertyPath.split(".");
  let current: unknown = json;

  for (const key of keys) {
    expect(current, `Expected ${propertyPath} to exist in ${filePath}`).toHaveProperty(key);
    current = (current as Record<string, unknown>)[key];
  }

  if (expectedValue !== undefined) {
    expect(current).toEqual(expectedValue);
  }
}

/**
 * Assert that package.json has a specific script
 */
export function assertPackageJsonScript(
  project: TestProject,
  scriptName: string,
  scriptValue?: string
): void {
  const pkg = project.readJson<{ scripts?: Record<string, string>; }>("package.json");
  expect(pkg.scripts, "Expected package.json to have scripts").toBeDefined();
  expect(pkg.scripts![scriptName], `Expected script "${scriptName}" to exist`).toBeDefined();

  if (scriptValue !== undefined) {
    expect(pkg.scripts![scriptName]).toBe(scriptValue);
  }
}


