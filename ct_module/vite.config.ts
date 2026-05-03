import { defineConfig, loadEnv } from "vite";
import { babel } from "@rollup/plugin-babel";
import { fileURLToPath } from "node:url";
import path from "node:path";

const languageDistPath = fileURLToPath(new URL("../language/dist/", import.meta.url));
const srcDir = fileURLToPath(new URL("./src/", import.meta.url));

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

// Load .env (no prefix filter) so we can gate optional features at build time.
const env = loadEnv("production", path.resolve(fileURLToPath(import.meta.url), ".."), "");
const mcpEnabled = ["1", "true", "yes", "on"].indexOf(
    String(env.HTSW_MCP_ENABLED ?? "").trim().toLowerCase()
) >= 0;

// When MCP is disabled, redirect the bridge import to an empty stub so the real
// implementation (HTTP code, daemon threads, /poll URL string, etc.) is never bundled
// into dist. We use a Rollup resolver instead of a Vite alias because Vite's regex aliases
// only replace the matched substring, which mangles absolute paths on Windows.
const mcpAliases: { find: RegExp | string; replacement: string }[] = [];
const mcpStubPath = path.resolve(srcDir, "mcp/bridge.stub.ts");
const mcpResolverPlugin = mcpEnabled
    ? null
    : {
          name: "htsw-mcp-disabled",
          enforce: "pre" as const,
          resolveId(source: string) {
              if (source === "./mcp/bridge" || source === "./bridge") {
                  return mcpStubPath;
              }
              return null;
          },
      };

export default defineConfig({
    esbuild: false,
    resolve: {
        alias: [...mcpAliases, ...htswAliases],
    } as const,
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
        ...(mcpResolverPlugin ? [mcpResolverPlugin] : []),
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
