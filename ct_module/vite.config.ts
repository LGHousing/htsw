import { defineConfig } from "vite";
import { babel } from "@rollup/plugin-babel";

export default defineConfig({
    esbuild: false,
    build: {
        lib: {
            entry: "./src/index.ts",
            formats: ["cjs"],
            fileName: () => "index.js",
        },
        outDir: "dist",
    },
    plugins: [
        babel({
            babelHelpers: "bundled",
            extensions: [".ts", ".tsx", ".js"],
            presets: [
                [
                    "@babel/preset-env",
                    {
                        targets: { ie: "11" },
                    },
                ],
                "@babel/preset-typescript",
            ],
        }),
    ],
});
