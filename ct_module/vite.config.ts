import { defineConfig } from "vite";
import { babel } from "@rollup/plugin-babel";
import { fileURLToPath } from "node:url";
import path from "node:path";

const languageDistPath = fileURLToPath(new URL("../language/dist/", import.meta.url));

const htswAliases = [
    { find: /^htsw$/, replacement: path.resolve(languageDistPath, "index.js") },
    {
        find: /^htsw\/types$/,
        replacement: path.resolve(languageDistPath, "types/index.js"),
    },
    {
        find: /^htsw\/runtime$/,
        replacement: path.resolve(languageDistPath, "runtime/index.js"),
    },
    {
        find: /^htsw\/htsw$/,
        replacement: path.resolve(languageDistPath, "htsw/index.js"),
    },
    { find: /^htsw\/nbt$/, replacement: path.resolve(languageDistPath, "nbt/index.js") },
];

export default defineConfig({
    esbuild: false,
    resolve: {
        alias: htswAliases,
    },
    build: {
        lib: {
            entry: "./src/index.ts",
            formats: ["cjs"],
            fileName: () => "index.js",
        },
        rollupOptions: {
            input: "./src/index.ts",
            output: {
                format: "cjs",
                dir: "dist",
                preserveModules: true,
            },
        },
        outDir: "dist",
    },
    plugins: [
        babel({
            babelHelpers: "inline",
            extensions: [".ts", ".tsx", ".js"],
            presets: [
                [
                    "@babel/preset-env",
                    {
                        targets: { ie: "11" },
                        loose: true,
                    },
                ],
                "@babel/preset-typescript",
            ],
            plugins: [
                ["@babel/plugin-proposal-class-properties", { loose: true }],
                ["@babel/plugin-transform-classes", { loose: true }],
            ],
        }),
    ],
});
