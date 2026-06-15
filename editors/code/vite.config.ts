import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectSrcPath = fileURLToPath(new URL("../../project/src/", import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            { find: /^htsw-project$/, replacement: path.resolve(projectSrcPath, "index.ts") },
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
