import { defineConfig, loadEnv } from "vite";
import { babel } from "@rollup/plugin-babel";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
    readdirSync,
    readFileSync,
    copyFileSync,
    mkdirSync,
    rmSync,
    statSync,
} from "node:fs";

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

// Icon tree-shake: scan the bundled JS for `Icons.<camelKey>` references and copy ONLY
// those PNGs from assets/icons/ into dist/assets/. This keeps the deploy small
// — assets/icons/ contains ~1500 icons but a typical build references a few dozen.
//
// We scan for the camelCase property access (`Icons.aArrowDown`) rather than the
// kebab-case filename (`"a-arrow-down"`), because many icon filenames collide with
// plain English strings in the codebase (`"container"`, `"delete"`, `"code"` all
// appear naturally in unrelated code) and would produce false-positive copies.
// Camel keys are unique to icon access. As a bonus, when nobody references `Icons`,
// Rollup tree-shakes the whole object out → zero matches → zero PNGs.
//
// Output is FLAT under dist/assets/ (no `icons/` subfolder): CT 1.8.9 was observed
// to hang at /ct reload when the deployed module dir contained nested non-.js
// subfolders. HTSL and HousingEditor both put PNGs flat under assets/, so we match.
const iconsSourceDir = path.resolve(srcDir, "../assets/icons");
const iconsDistDir = path.resolve(srcDir, "../dist/assets");

function kebabToCamel(name: string): string {
    return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function listIconNames(): string[] {
    let entries: string[];
    try {
        entries = readdirSync(iconsSourceDir);
    } catch {
        return [];
    }
    const out: string[] = [];
    for (const entry of entries) {
        if (entry.toLowerCase().endsWith(".png")) out.push(entry.slice(0, -4));
    }
    return out;
}

function escapeForRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readAllJsBundles(distDir: string): string {
    const parts: string[] = [];
    function walk(dir: string): void {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry);
            const st = statSync(full);
            if (st.isDirectory()) {
                if (entry === "assets") continue; // don't scan our own emitted icons
                walk(full);
            } else if (st.isFile() && entry.endsWith(".js")) {
                parts.push(readFileSync(full, "utf8"));
            }
        }
    }
    walk(distDir);
    return parts.join("\n");
}

const iconShakePlugin = {
    name: "htsw-icon-shake",
    apply: "build" as const,
    closeBundle(): void {
        const distDir = path.resolve(srcDir, "../dist");
        const all = readAllJsBundles(distDir);
        const names = listIconNames();
        // Reset any previously-emitted icons so renaming/removing usages shrinks the deploy.
        try {
            rmSync(iconsDistDir, { recursive: true, force: true });
        } catch {
            // ignore
        }

        let used = 0;
        for (const name of names) {
            const camel = kebabToCamel(name);
            // Match `Icons.<camelKey>` only — `\b` anchors the right edge so e.g.
            // `Icons.arrow` doesn't also fire for `Icons.arrowUp`.
            const pat = new RegExp("\\bIcons\\." + escapeForRegex(camel) + "\\b");
            if (!pat.test(all)) continue;
            mkdirSync(iconsDistDir, { recursive: true });
            copyFileSync(
                path.join(iconsSourceDir, name + ".png"),
                path.join(iconsDistDir, name + ".png")
            );
            used++;
        }
        console.log(`htsw-icon-shake: copied ${used} of ${names.length} icons to dist/assets/`);
    },
};

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
                generatedCode: { constBindings: false },
            },
        },
        outDir: "dist",
    },
    plugins: [
        ...(mcpResolverPlugin ? [mcpResolverPlugin] : []),
        iconShakePlugin,
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
