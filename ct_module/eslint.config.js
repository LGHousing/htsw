import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "dist/**",
            "node_modules/**",
            "out/**",
            "scripts/**",
            "vite.config.ts",
            "eslint.config.js",
        ],
    },
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            "@typescript-eslint": tseslint.plugin,
        },
        rules: {
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/switch-exhaustiveness-check": "error",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "no-restricted-syntax": [
                "error",
                {
                    selector: "CallExpression[callee.object.name='Promise'][callee.property.name='race']",
                    message:
                        "Use ctx.race(...) instead of Promise.race(...). Raw Promise.race leaves WaitForPromise losers registered in EVENT_CONTAINERS, which silently consume future packets meant for unrelated waiters.",
                },
            ],
        },
    },
    {
        files: ["src/tasks/context.ts"],
        rules: {
            "no-restricted-syntax": "off",
        },
    }
);
