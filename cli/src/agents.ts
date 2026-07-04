import fs from "node:fs";
import path from "node:path";
import { ansi } from "./ansi";
import { GUIDES, GUIDE_SOURCE_VERSION } from "./generated/guides";

type Target = "claude" | "codex";

const BLOCK_START = "<!-- htsw:guides START -->";
const BLOCK_END = "<!-- htsw:guides END -->";

const AGENTS_POINTER = [
    "## HTSW + Housing guides for agents",
    "",
    "Guides for working with HTSW (Hypixel Housing scripting) in this project are in",
    "`.htsw/agents/information.md`. Read that first; it links to the Housing reference",
    "under `.htsw/housing/` and the HTSW patterns under `.htsw/agents/`.",
].join("\n");

export function runAgents(args: string[]): void {
    const sub = args[0];
    if (sub === "install") {
        runAgentsInstall(args.slice(1));
        return;
    }
    printAgentsHelp();
    process.exit(sub && sub !== "help" && sub !== "--help" && sub !== "-h" ? 2 : 0);
}

function runAgentsInstall(args: string[]): void {
    let dir = process.cwd();
    const explicit: Target[] = [];
    let all = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--help" || arg === "-h") {
            printAgentsHelp();
            process.exit(0);
        } else if (arg === "--claude") {
            explicit.push("claude");
        } else if (arg === "--codex") {
            explicit.push("codex");
        } else if (arg === "--all") {
            all = true;
        } else if (arg === "--dir") {
            const next = args[++i];
            if (!next) {
                console.error("--dir expects a path");
                process.exit(2);
            }
            dir = path.resolve(next);
        } else {
            console.error(`Unknown option '${arg}'.`);
            printAgentsHelp();
            process.exit(2);
        }
    }

    if (!Object.keys(GUIDES).some((key) => key.startsWith("agents/"))) {
        console.error(
            "This htsw build carries no agent guides.\n" +
            "Rebuild the CLI with HTSW_DOCS_PATH set to a LGHousing/docs clone, " +
            "or reinstall a release build."
        );
        process.exit(1);
    }

    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        console.error(`Not a directory: ${dir}`);
        process.exit(2);
    }

    const targets = resolveTargets(dir, explicit, all);
    const written = writeGuides(dir);

    // AGENTS.md is the one home for the pointer; CLAUDE.md imports it so the
    // text lives in a single place regardless of which agent reads it.
    const touched: string[] = [];
    upsertBlock(path.join(dir, "AGENTS.md"), AGENTS_POINTER);
    touched.push("AGENTS.md");

    if (targets.includes("claude")) {
        const claudeChange = linkClaudeToAgents(dir);
        if (claudeChange) touched.push(claudeChange);
    }

    console.log(
        ansi("green", `Installed ${written} guide files to .htsw/`) +
        ` (guides @ ${GUIDE_SOURCE_VERSION})`
    );
    console.log(`Agents wired: ${targets.join(", ")}`);
    console.log(`Updated: ${touched.join(", ")}`);
}

function resolveTargets(dir: string, explicit: Target[], all: boolean): Target[] {
    if (all) return ["claude", "codex"];
    if (explicit.length) return [...new Set(explicit)];

    const detected: Target[] = [];
    if (fs.existsSync(path.join(dir, "CLAUDE.md")) || fs.existsSync(path.join(dir, ".claude"))) {
        detected.push("claude");
    }
    if (fs.existsSync(path.join(dir, "AGENTS.md")) || fs.existsSync(path.join(dir, ".codex"))) {
        detected.push("codex");
    }
    return detected.length ? detected : ["claude", "codex"];
}

function writeGuides(dir: string): number {
    const root = path.join(dir, ".htsw");
    for (const sub of ["agents", "housing", "htsw"]) {
        fs.rmSync(path.join(root, sub), { recursive: true, force: true });
    }
    let count = 0;
    for (const [relPath, content] of Object.entries(GUIDES)) {
        const dest = path.join(root, relPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content);
        count++;
    }
    return count;
}

function linkClaudeToAgents(dir: string): string | null {
    const claudePath = path.join(dir, "CLAUDE.md");
    if (!fs.existsSync(claudePath)) {
        fs.writeFileSync(claudePath, "@AGENTS.md\n");
        return "CLAUDE.md";
    }
    const text = fs.readFileSync(claudePath, "utf8");
    if (/AGENTS\.md/.test(text)) {
        return null; // already points at AGENTS.md; don't duplicate
    }
    upsertBlock(claudePath, "@AGENTS.md");
    return "CLAUDE.md";
}

function upsertBlock(file: string, body: string): void {
    const block = `${BLOCK_START}\n${body}\n${BLOCK_END}`;
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";

    const start = text.indexOf(BLOCK_START);
    const end = text.indexOf(BLOCK_END);
    let next: string;
    if (start !== -1 && end !== -1) {
        next = text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
    } else if (text.trim().length === 0) {
        next = block + "\n";
    } else {
        next = text.replace(/\s*$/, "") + "\n\n" + block + "\n";
    }
    fs.writeFileSync(file, next);
}

function printAgentsHelp(): void {
    console.log("Usage: htsw agents install [--claude | --codex | --all] [--dir <path>]");
    console.log("");
    console.log("Installs the HTSW + Housing agent guides into a project so coding");
    console.log("agents can read them. Writes the guides to .htsw/ and wires the");
    console.log("agent's instruction file to point at them:");
    console.log("");
    console.log("  - AGENTS.md gets a managed guides block (read by Codex).");
    console.log("  - CLAUDE.md imports AGENTS.md via @AGENTS.md (read by Claude Code),");
    console.log("    so nothing is duplicated.");
    console.log("");
    console.log("  --claude      Wire up Claude Code (CLAUDE.md imports AGENTS.md).");
    console.log("  --codex       Wire up Codex (AGENTS.md only).");
    console.log("  --all         Both.");
    console.log("  --dir <path>  Target project (default: current directory).");
    console.log("");
    console.log("Default with no flag: detect from the project, else wire both.");
    console.log("Re-running refreshes the guides and rewrites the managed block.");
}
