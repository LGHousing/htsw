import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { importerClientModules } from "./scripts/importerClientModules";

const languageDistPath = fileURLToPath(new URL("../language/dist/", import.meta.url));
const importerSrcPath = fileURLToPath(new URL("../importer/src/", import.meta.url));
const commonProjectSrcPath = fileURLToPath(new URL("../editors/common/src/project/", import.meta.url));

export default defineConfig({
    plugins: [importerClientModules()],
    resolve: {
        alias: [
            { find: /^htsw$/, replacement: path.resolve(languageDistPath, "index.js") },
            { find: /^htsw\/types$/, replacement: path.resolve(languageDistPath, "types/index.js") },
            { find: /^htsw\/runtime$/, replacement: path.resolve(languageDistPath, "runtime/index.js") },
            { find: /^htsw\/htsw$/, replacement: path.resolve(languageDistPath, "htsw/index.js") },
            { find: /^htsw\/nbt$/, replacement: path.resolve(languageDistPath, "nbt/index.js") },
            // importer/ has no node_modules of its own in CI; resolve it the way vite.config.ts does.
            {
                find: /^htsw-editor-common\/project$/,
                replacement: path.resolve(commonProjectSrcPath, "index.ts"),
            },
            { find: /^@htsw\/importer$/, replacement: path.resolve(importerSrcPath, "index.ts") },
            { find: /^@htsw\/importer\/(.*)$/, replacement: `${importerSrcPath}$1` },
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
