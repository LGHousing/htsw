import { readdirSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const iconsDir = path.resolve(repoRoot, "assets/icons");
const outputPath = path.resolve(repoRoot, "src/gui/lib/icons.generated.ts");

function kebabToCamel(name: string): string {
    return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function main(): void {
    let entries: string[];
    try {
        entries = readdirSync(iconsDir);
    } catch (err) {
        throw new Error(`Could not read ${iconsDir}: ${(err as Error).message}`);
    }

    const names: string[] = [];
    for (const entry of entries) {
        if (!entry.toLowerCase().endsWith(".png")) continue;
        names.push(entry.slice(0, -4));
    }
    names.sort();

    // Detect camelCase collisions before emit so two filenames don't quietly map to one key.
    const byKey = new Map<string, string>();
    for (const name of names) {
        const key = kebabToCamel(name);
        const existing = byKey.get(key);
        if (existing !== undefined) {
            throw new Error(
                `Icon name collision: "${existing}" and "${name}" both map to "${key}". Rename one.`
            );
        }
        byKey.set(key, name);
    }

    const lines: string[] = [];
    lines.push("// AUTO-GENERATED — do not edit. Run `npm run generate:icons`.");
    lines.push("// Source: ct_module/assets/icons/*.png");
    lines.push("");
    lines.push("export const Icons = {");
    for (const [key, name] of byKey) {
        lines.push(`    ${key}: "${name}",`);
    }
    lines.push("} as const;");
    lines.push("");
    lines.push("export type IconName = typeof Icons[keyof typeof Icons];");
    lines.push("");
    const next = lines.join("\n");

    // Skip the write when content is unchanged so the file's mtime stays stable
    // (avoids Vite/tsc spurious re-runs in watch mode).
    let prev: string | null = null;
    try {
        prev = readFileSync(outputPath, "utf8");
    } catch {
        prev = null;
    }
    if (prev === next) {
        console.log(`generateIconsList: ${names.length} icons (unchanged)`);
        return;
    }

    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, next, "utf8");
    console.log(`generateIconsList: wrote ${names.length} icons to ${outputPath}`);
}

main();
