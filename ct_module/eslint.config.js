import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**", "CTAutocomplete/**"],
    },
    {
        files: ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"],
        extends: tseslint.configs.strictTypeChecked,
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/require-await": "off",
            "@typescript-eslint/restrict-template-expressions": [
                "error",
                {
                    allowBoolean: true,
                    allowNumber: true,
                },
            ],
            "@typescript-eslint/restrict-plus-operands": [
                "error",
                {
                    allowNumberAndString: true,
                },
            ],
            "@typescript-eslint/no-confusing-void-expression": [
                "error",
                {
                    ignoreArrowShorthand: true,
                },
            ],
            "@typescript-eslint/no-dynamic-delete": "off",
            "@typescript-eslint/no-extraneous-class": [
                "error",
                {
                    allowStaticOnly: true,
                },
            ],
            "@typescript-eslint/only-throw-error": [
                "error",
                {
                    allow: ["Diagnostic"],
                },
            ],
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
        },
    },
    {
        files: ["test/**/*.ts"],
        rules: {
            "@typescript-eslint/no-non-null-assertion": "off",
        },
    }
);
