import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const languageDistPath = fileURLToPath(new URL("../language/dist/", import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            { find: /^htsw$/, replacement: path.resolve(languageDistPath, "index.js") },
            { find: /^htsw\/types$/, replacement: path.resolve(languageDistPath, "types/index.js") },
            { find: /^htsw\/runtime$/, replacement: path.resolve(languageDistPath, "runtime/index.js") },
            { find: /^htsw\/htsw$/, replacement: path.resolve(languageDistPath, "htsw/index.js") },
            { find: /^htsw\/nbt$/, replacement: path.resolve(languageDistPath, "nbt/index.js") },
        ],
    },
    test: {
        include: ["test/**/*.test.ts"],
        setupFiles: ["./test/setup.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/**/*.ts"],
            exclude: [
                "**/*.test.ts",
                "**/index.ts",
                "dist/**",
                "src/CTAutocomplete.d.ts",
            ],
            reportOnFailure: true,
        },
    },
});
