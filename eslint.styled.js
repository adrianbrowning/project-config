// https://typescript-eslint.io/users/configs/#recommended
//
// export default tseslint.config(...tseslint.configs.stylistic);
// export default tseslint.config(...tseslint.configs.stylisticTypeChecked);

import stylistic from "@stylistic/eslint-plugin";
import path from "node:path";
import {fileURLToPath} from "node:url";
import js from "@eslint/js";
import {FlatCompat} from "@eslint/eslintrc";
import unusedImports from "eslint-plugin-unused-imports";
import {fixupPluginRules} from "@eslint/compat";
import {has} from "./src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

const hasTypeScript = has('typescript')

export const config = [
    ...(await import('./eslint.js')).default,
    {
        plugins: {
            "@stylistic": stylistic,
            "simple-import-sort": (await import('eslint-plugin-simple-import-sort')).default,
            "unused-imports": fixupPluginRules(unusedImports),
        },

        rules: {
            "arrow-body-style": [
                "error",
                "as-needed"
            ],
            'import/order': [
                "error",
                {
                    alphabetize: {order: 'asc', caseInsensitive: true},
                    pathGroups: [{pattern: '#*/**', group: 'internal'}],
                    groups: [
                        'builtin',
                        'external',
                        'internal',
                        'parent',
                        'sibling',
                        'index',
                    ],
                },
            ],
            "unused-imports/no-unused-imports": "error",
            "@stylistic/array-bracket-spacing": ["error", "always", {
                arraysInArrays: false,
                objectsInArrays: false,
            }],
            "@stylistic/arrow-parens": ["error", "as-needed"],
            "@stylistic/brace-style": ["error", "stroustrup", {
                allowSingleLine: true,
            }],
            "@stylistic/comma-dangle": ["error", {
                arrays: "always-multiline",
                exports: "never",
                functions: "never",
                imports: "never",
                objects: "always-multiline",
            }],
            "@stylistic/comma-spacing": [
                "error"
            ],
            "@stylistic/indent": ["error", 2, {
                SwitchCase: 1,
            }],
            "@stylistic/jsx-closing-bracket-location": ["error", "line-aligned"],
            "@stylistic/jsx-curly-brace-presence": ["error", {
                children: "always",
                propElementValues: "always",
                props: "never",
            }],
            "@stylistic/jsx-curly-newline": "off",
            "@stylistic/jsx-max-props-per-line": ["error", {
                maximum: {
                    multi: 1,
                    single: 2,
                },
            }],
            "@stylistic/linebreak-style": ["error", "unix"],
            "@stylistic/max-len": ["error", {
                code: 400,
                ignoreStrings: true,
            }],
            "@stylistic/member-delimiter-style": ["error", {
                multiline: {
                    delimiter: "semi",
                    requireLast: true,
                },

                singleline: {
                    delimiter: "semi",
                    requireLast: true,
                },
            }],
            "@stylistic/newline-per-chained-call": ["error", {
                ignoreChainWithDepth: 2,
            }],
            "@stylistic/no-multi-spaces": "error",
            "@stylistic/no-multiple-empty-lines": ["error", {
                max: 1,
                maxEOF: 1,
                maxBOF: 0,
            }],
            "@stylistic/nonblock-statement-body-position": ["error", "beside"],
            "@stylistic/object-curly-spacing": ["error", "always", {
                arraysInObjects: true,
                objectsInObjects: true,
            }],
            "@stylistic/object-property-newline": ["error", {
                allowAllPropertiesOnSameLine: true,
                allowMultiplePropertiesPerLine: false,
            }],
            "@stylistic/quotes": ["error", "double", {
                allowTemplateLiterals: true,
            }],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/type-annotation-spacing": "error",
            "simple-import-sort/imports": "error",
        },
    },
    hasTypeScript
        ? {
            files: ['**/*.ts?(x)'],
            languageOptions: {
                parser: (await import('typescript-eslint')).parser,
                parserOptions: {
                    projectService: true,
                },
            },
            plugins: {
                '@typescript-eslint': (await import('typescript-eslint')).plugin,
            },
            rules: {
                "@typescript-eslint/consistent-type-imports": [
                    "error",
                    {
                        prefer: 'type-imports',
                        "fixStyle": "separate-type-imports",
                        disallowTypeAnnotations: true,
                    }
                ],
            },
        } : null,
].filter(Boolean);

export default config;
