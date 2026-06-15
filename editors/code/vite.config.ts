import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const commonProjectSrcPath = fileURLToPath(new URL("../common/src/project/", import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^htsw-editor-common\/project$/,
                replacement: path.resolve(commonProjectSrcPath, "index.ts"),
            },
        ],
    },
    build: {
        lib: {
            entry: "./src/main.ts",
            formats: ["cjs"],
            fileName: "extension",
        },
        rollupOptions: {
            external: ["vscode", /^node:/],
        },
        sourcemap: true,
        outDir: "dist",
    },
    plugins: [],
});
