import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";

import eslintReact from "@eslint-react/eslint-plugin";
import vitest from "@vitest/eslint-plugin";
import depend from "eslint-plugin-depend";
import noBarrelFiles from "eslint-plugin-no-barrel-files";
// eslint-disable-next-line depend/ban-dependencies
import reactPlugin from "eslint-plugin-react"; // We are still using- jsx-props-no-spreading, jsx-no-bind
import reactCompilerPlugin from "eslint-plugin-react-compiler";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import tseslint from "typescript-eslint";
import type { YES_ANY_IS_OK_HERE } from "./types";
import { has } from "./utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

const ERROR = "error" as const;
const WARN = "warn" as const;

const hasTypeScript = has("typescript");
const hasReact = has("react");
const hasTestingLibrary = has("@testing-library/dom");
const hasJestDom = has("@testing-library/jest-dom");
const hasVitest = has("vitest");
const vitestFiles = [ "**/__tests__/**/*", "**/*.test.*" ];
const testFiles = [ "**/tests/**", "**/#tests/**", ...vitestFiles ];
const playwrightFiles = [ "**/e2e/**" ];

const reactHooksPlugin = hasReact ? (await import("eslint-plugin-react-hooks")).default : null;

const getTsconfigRootDir = () => {
  const dir = import.meta.dirname.toString();
  const idx = dir.indexOf("/node_modules/");
  if (idx !== -1) {
    return dir.substring(0, idx);
  }
  // When running locally (not from node_modules), go up from src/ to project root
  return path.resolve(dir, "..");
};

const typescriptRules = hasTypeScript ? [{
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: true,
      tsconfigRootDir: getTsconfigRootDir(),
    },
  },
  files: [ "**/*.d.ts", "**/*.ts?(x)" ],
  plugins: {
    "@typescript-eslint": tseslint.plugin,
  },
  rules: {
    "@typescript-eslint/no-empty-object-type": "error",
    "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
    "@typescript-eslint/no-unsafe-function-type": "error",
    "@typescript-eslint/no-wrapper-object-types": "error",
    "no-redeclare": "off",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/array-type": [
      "error",
      {
        "default": "generic",
      },
    ],
    "@typescript-eslint/await-thenable": [
      "error",
    ],
    "@typescript-eslint/no-floating-promises": [ "error" ],
    "@typescript-eslint/no-misused-promises": [ "error" ],
    "@typescript-eslint/no-unnecessary-condition": [ "error" ],
    "@typescript-eslint/no-unnecessary-type-assertion": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        args: "after-used",
        "argsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/promise-function-async": [
      "error",
    ],
    "@typescript-eslint/method-signature-style": [
      "error",
      "property",
    ],
    "@typescript-eslint/no-deprecated": WARN,
    "import/consistent-type-specifier-style": WARN,

    // here are rules we've decided to not enable. Commented out rather
    // than setting them to disabled to avoid them being referenced at all
    // when config resolution happens.

    // @typescript-eslint/require-await - sometimes you really do want
    // async without await to make a function async. TypeScript will ensure
    // it's treated as an async function by consumers and that's enough for me.

    // @typescript-eslint/prefer-promise-reject-errors - sometimes you
    // aren't the one creating the error and you just want to propogate an
    // error object with an unknown type.

    // @typescript-eslint/only-throw-error - same reason as above.
    // However this rule supports options to allow you to throw `any` and
    // `unknown`. Unfortunately, in Remix you can throw Response objects
    // and we don't want to enable this rule for those cases.

    // @typescript-eslint/no-unsafe-declaration-merging - this is a rare
    // enough problem (especially if you focus on types over interfaces)
    // that it's not worth enabling.

    // @typescript-eslint/no-unsafe-enum-comparison - enums are not
    // recommended or used in epic projects, so it's not worth enabling.

    // @typescript-eslint/no-unsafe-unary-minus - this is a rare enough
    // problem that it's not worth enabling.

    // @typescript-eslint/no-base-to-string - this doesn't handle when
    // your object actually does implement toString unless you do so with
    // a class which is not 100% of the time. For example, the timings
    // object in the epic stack uses defineProperty to implement toString.
    // It's not high enough risk/impact to enable.

    // @typescript-eslint/no-non-null-assertion - normally you should not
    // use ! to tell TS to ignore the null case, but you're a responsible
    // adult and if you're going to do that, the linter shouldn't yell at
    // you about it.

    // @typescript-eslint/restrict-template-expressions - toString is a
    // feature of many built-in objects and custom ones. It's not worth
    // enabling.

    // @typescript-eslint/no-confusing-void-expression - what's confusing
    // to one person isn't necessarily confusing to others. Arrow
    // functions that call something that returns void is not confusing
    // and the types will make sure you don't mess something up.

    // these each protect you from `any` and while it's best to avoid
    // using `any`, it's not worth having a lint rule yell at you when you
    // do:
    // - @typescript-eslint/no-unsafe-argument
    // - @typescript-eslint/no-unsafe-call
    // - @typescript-eslint/no-unsafe-member-access
    // - @typescript-eslint/no-unsafe-return
    // - @typescript-eslint/no-unsafe-assignment
  },
}] : [];

export const nodeRules = [
  ...compat.extends(
    "plugin:security-node/recommended"
  ),
  {
    plugins: {
      "security-node": (await import("eslint-plugin-security-node")).default,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "security-node/detect-crlf": "off",
      "security-node/detect-unhandled-event-errors": "off",

      "node/file-extension-in-import": [
        "error",
        "always",
      ],
      "node/no-missing-import": [ "off" ],
      "node/no-unpublished-import": [ "off" ],
    },
  },
];

const eslPlugProm = (await import("eslint-plugin-promise")).default;

export const config = [
  {
    ignores: [
      "**/.cache/**",
      "**/node_modules/**",
      "**/build/**",
      "**/public/build/**",
      "**/playwright-report/**",
      "**/server-build/**",
      "**/dist/**",
    ],
  },

  {
    plugins: {
      "unicorn" : (await import("eslint-plugin-unicorn")).default,
    },
    rules: {
      "unicorn/prefer-node-protocol" : "error",
    },
  },

  js.configs.recommended,

  // SonarJS - code smells and bug detection
  sonarjs.configs.recommended,
  {
    rules: {
      "sonarjs/no-redundant-jump": "off",
      "sonarjs/void-use": "off",
    },
  },

  // Depend - detect dependency bloat and redundant polyfills
  {
    plugins: { depend },
    rules: {
      "depend/ban-dependencies": ERROR,
    },
  },

  // Barrel files - avoid barrel file anti-patterns
  noBarrelFiles.flat,

  // all files
  {
    plugins: {
      import: (await import("eslint-plugin-import-x")).default,
      promise: eslPlugProm,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...eslPlugProm.configs?.recommended?.rules,
      "no-unused-labels": "off",
      "no-unexpected-multiline": ERROR,
      "no-warning-comments": [
        ERROR,
        { terms: [ "FIXME" ], location: "anywhere" },
      ],
      // 'import/no-duplicates': [WARN, { 'prefer-inline': true }],
      "prefer-promise-reject-errors": [
        "error",
      ],
      "promise/always-return": [
        "error",
      ],
      "promise/catch-or-return": [
        "error",
        {
          "allowThen": true,
        },
      ],

      "max-nested-callbacks": "error",
      "no-debugger": [ "warn" ],
      "no-fallthrough": [ "warn" ],
      "no-return-await": [
        "error",
      ],
      "no-await-in-loop": [ "warn" ], //optional
    },
  },

  // JSX/TSX files - @eslint-react (main rules)
  hasReact
    ? {
      files: [ "**/*.tsx", "**/*.jsx" ],
      ...eslintReact.configs["recommended-typescript"],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          jsx: true,
          projectService: true,
        },
      },
      rules: {
        "no-undef": "off",
        "no-unused-vars": "off",
        "@eslint-react/no-nested-component-definitions": "error",
        "@eslint-react/no-unstable-context-value": "error",
        "@eslint-react/dom/no-script-url": "error",
        "@eslint-react/dom/no-unsafe-target-blank": "error",
        "@eslint-react/no-array-index-key": "error",
        "@eslint-react/dom/no-dangerously-set-innerhtml": "error",
        "@eslint-react/dom/no-dangerously-set-innerhtml-with-children": "error",
        "@eslint-react/dom/no-unknown-property": "error",
        "@eslint-react/no-missing-key": "error",
        "@eslint-react/dom/no-missing-button-type": "error",
        "@eslint-react/prefer-destructuring-assignment": "error",
        "@eslint-react/no-missing-component-display-name": "error",
      },
    }
    : null,

  // JSX/TSX files - eslint-plugin-react (stylistic rules without @eslint-react equivalents)
  hasReact
    ? {
      files: [ "**/*.tsx", "**/*.jsx" ],
      plugins: {
        react: reactPlugin,
      },
      rules: {
        "react/jsx-props-no-spreading": "error",
        "react/jsx-no-bind": "error",
      },
    }
    : null,

  // react-hook rules are applicable in ts/js/tsx/jsx, but only with React as a
  // dep

  // hasReact ? {
  //     plugins: {
  //         'react-hooks': reactHooksPlugin,
  //     },
  //     rules: reactHooksPlugin?.configs.recommended.rules,
  // } : null,
  hasReact
    ? {
      files: [ "**/*.ts?(x)", "**/*.js?(x)" ],
      plugins: {
        "react-hooks": reactHooksPlugin,
        // 'react-hooks': fixupPluginRules(
        // 	await import('eslint-plugin-react-hooks'),
        // ),
      },
      rules: {
        ...reactHooksPlugin?.configs.recommended.rules,
        "react-hooks/exhaustive-deps": [ "error" ],
        "react-hooks/rules-of-hooks": [ "error" ],
      },
    }
    : null,

  // react-hook rules are applicable in ts/js/tsx/jsx, but only with React as a
  // dep

  // hasReact ? compat.extends("plugin:react-hooks/recommended")[0] : null,
  hasReact
    ? {
      files: [ "**/*.ts?(x)", "**/*.js?(x)" ],
      plugins: {
        "react-compiler": reactCompilerPlugin,
      },
      rules: {
        "react-compiler/react-compiler": [ "error" ],
      },
    }
    : null,

  // React Refresh - Fast Refresh compatibility
  hasReact
    ? {
      files: [ "**/*.tsx", "**/*.jsx" ],
      plugins: {
        "react-refresh": (await import("eslint-plugin-react-refresh")).default,
      },
      rules: {
        "react-refresh/only-export-components": [ WARN, { allowConstantExport: true }],
      },
    }
    : null,

  // JSX A11y - Accessibility rules for JSX
  hasReact
    ? {
      files: [ "**/*.tsx", "**/*.jsx" ],
      ...(await import("eslint-plugin-jsx-a11y")).default.flatConfigs.recommended,
      rules: {
        // Override specific rules if needed
        "jsx-a11y/anchor-is-valid": ERROR,
        "jsx-a11y/click-events-have-key-events": ERROR,
        "jsx-a11y/no-static-element-interactions": ERROR,
      },
    }
    : null,

  // TS and TSX files
  ...typescriptRules,

  // This assumes test files are those which are in the test directory or have
  // *.test.* in the filename. If a file doesn't match this assumption, then it
  // will not be allowed to import test files.
  {
    files: [ "**/*.ts?(x)", "**/*.js?(x)" ],
    ignores: testFiles,
    rules: {
      "no-restricted-imports": [
        ERROR,
        {
          patterns: [
            {
              group: testFiles,
              message: "Do not import test files in source files",
            },
          ],
        },
      ],
    },
  },

  hasTestingLibrary
    ? {
      files: testFiles,
      ignores: [ ...playwrightFiles ],
      plugins: {
        "testing-library": (await import("eslint-plugin-testing-library"))
          .default,
      },
      rules: {
        "testing-library/no-unnecessary-act": [ ERROR, { isStrict: false }],
        "testing-library/no-wait-for-side-effects": ERROR,
        "testing-library/prefer-find-by": ERROR,
      },
    }
    : null,

  hasJestDom
    ? {
      files: testFiles,
      ignores: [ ...playwrightFiles ],
      plugins: {
        "jest-dom": (await import("eslint-plugin-jest-dom")).default,
      },
      rules: {
        "jest-dom/prefer-checked": ERROR,
        "jest-dom/prefer-enabled-disabled": ERROR,
        "jest-dom/prefer-focus": ERROR,
        "jest-dom/prefer-required": ERROR,
      },
    }
    : null,

  hasVitest
    ? {
      files: testFiles,
      ignores: [ ...playwrightFiles ],
      plugins: {
        vitest,
      },
      rules: {
        // you don't want the editor to autofix this, but we do want to be
        // made aware of it
        ...vitest.configs.recommended.rules, // you can also use vitest.configs.all.rules to enable all rules
        "vitest/max-nested-describe": [ "error", { max: 3 }], // you can also modify rules' behavior using option like this
      },
    }
    : null,

  // JS and JSX files
  hasTypeScript ? {
    files: [ "**/*.{j,t}s?(x)" ],
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  } : {
    files: [ "**/*.js?(x)" ],
    rules: {
      // most of these rules are useful for JS but not TS because TS handles these better
      // if it weren't for https://github.com/import-js/eslint-plugin-import/issues/2132
      // we could enable this :(
      // 'import/no-unresolved': ERROR,
      "no-unused-vars": [
        WARN,
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
].filter(Boolean) as unknown as Array<YES_ANY_IS_OK_HERE>;

// this is for backward compatibility
export default config;
