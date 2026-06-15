import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "dist/**",
            "node_modules/**",
            "CTAutocomplete/**",
        ],
    },
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
        },
    }
);
