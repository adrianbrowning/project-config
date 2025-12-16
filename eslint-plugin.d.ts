// eslint-plugin-promise.d.ts
declare module 'eslint-plugin-promise' {
    import { Linter } from 'eslint';

    const plugin: {
        configs?: {
            recommended?: Linter.Config;
            // add more if you know them
        };
        rules?: {
            [ruleName: string]: Linter.RuleModule;
        };
    };

    export = plugin;
}

declare module 'eslint-plugin-security-node' {
    import { Linter } from 'eslint';

    const plugin: {
        configs?: {
            recommended?: Linter.Config;
            // add more if you know them
        };
        rules?: {
            [ruleName: string]: Linter.RuleModule;
        };
    };

    export = plugin;
}
