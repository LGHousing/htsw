import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const commonProjectSrcPath = fileURLToPath(new URL("../common/src/project/", import.meta.url));
const commonItemSrcPath = fileURLToPath(new URL("../common/src/item/", import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^htsw-editor-common\/project$/,
                replacement: path.resolve(commonProjectSrcPath, "index.ts"),
            },
            {
                find: /^htsw-editor-common\/item\/buildItemNbt$/,
                replacement: path.resolve(commonItemSrcPath, "buildItemNbt.ts"),
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
