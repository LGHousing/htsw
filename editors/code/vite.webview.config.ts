import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const languageDistPath = fileURLToPath(new URL("../../language/dist/", import.meta.url));
const commonItemSrcPath = fileURLToPath(new URL("../common/src/item/", import.meta.url));
const commonTextSrcPath = fileURLToPath(new URL("../common/src/text/", import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            { find: /^htsw$/, replacement: path.resolve(languageDistPath, "index.js") },
            { find: /^htsw\/nbt$/, replacement: path.resolve(languageDistPath, "nbt/index.js") },
            {
                find: /^htsw-editor-common\/item\/buildItemNbt$/,
                replacement: path.resolve(commonItemSrcPath, "buildItemNbt.ts"),
            },
            {
                find: /^htsw-editor-common\/text\/colorCodes$/,
                replacement: path.resolve(commonTextSrcPath, "colorCodes.ts"),
            },
        ],
    },
    build: {
        outDir: "dist/webview",
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            input: {
                tools: "src/webview/tools/main.ts",
                itemEditor: "src/webview/itemEditor/main.ts",
                soundPreviewer: "src/webview/soundPreviewer/main.ts",
            },
            output: {
                format: "es",
                entryFileNames: "[name].js",
            },
        },
    },
});
