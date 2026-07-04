import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ansi } from "./ansi";

const DEFAULT_BASE = "https://legendarygames.dev/htsw";

export async function runUpgrade(args: string[]): Promise<void> {
    let force = false;
    for (const arg of args) {
        if (arg === "--help" || arg === "-h") {
            printUpgradeHelp();
            return;
        } else if (arg === "--force") {
            force = true;
        } else {
            console.error(`Unknown option '${arg}'.`);
            printUpgradeHelp();
            process.exit(2);
        }
    }

    const base = `${process.env.HTSW_BASE_URL ?? DEFAULT_BASE}/cli`;
    const target = resolveSelfPath();

    const manifest = await fetchJson(`${base}/latest.json`);
    const version = String(manifest.version ?? "?");
    const file = String(manifest.cli ?? "");
    const sha = String(manifest.sha256 ?? "");
    if (!file) {
        console.error("manifest is missing the 'cli' filename");
        process.exit(1);
    }

    if (!force && sha && fs.existsSync(target) && sha256OfFile(target) === sha) {
        console.log(`Already up to date (htsw ${version}).`);
        return;
    }

    const buf = await fetchBuffer(`${base}/${file}`);
    if (sha) {
        const got = crypto.createHash("sha256").update(buf).digest("hex");
        if (got !== sha) {
            console.error(`sha256 mismatch (expected ${sha}, got ${got})`);
            process.exit(1);
        }
    }

    // Write a sibling temp file and rename over the running binary — atomic on
    // Unix, and safe because this process already loaded its script into memory.
    const tmp = path.join(path.dirname(target), `.htsw-upgrade-${process.pid}`);
    try {
        fs.writeFileSync(tmp, buf, { mode: 0o755 });
        fs.renameSync(tmp, target);
    } catch (err) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
        if ((err as NodeJS.ErrnoException)?.code === "EACCES") {
            console.error(
                `Cannot write ${target} (permission denied). Re-run the installer:\n` +
                `  curl -fsSL ${DEFAULT_BASE}/cli/install.sh | sh`
            );
        } else {
            console.error(`Upgrade failed: ${(err as Error)?.message ?? err}`);
        }
        process.exit(1);
    }

    console.log(ansi("green", `Updated htsw to ${version}.`));
}

function resolveSelfPath(): string {
    const argv1 = process.argv[1];
    if (!argv1) {
        console.error("Could not resolve the htsw binary path to upgrade.");
        process.exit(1);
    }
    try {
        return fs.realpathSync(argv1);
    } catch {
        return path.resolve(argv1);
    }
}

function sha256OfFile(filePath: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
    const res = await fetch(url);
    if (!res.ok) {
        console.error(`Could not fetch ${url} (${res.status})`);
        process.exit(1);
    }
    return res.json() as Promise<Record<string, unknown>>;
}

async function fetchBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) {
        console.error(`Download failed ${res.status}: ${url}`);
        process.exit(1);
    }
    return Buffer.from(await res.arrayBuffer());
}

function printUpgradeHelp(): void {
    console.log("Usage: htsw upgrade [--force]");
    console.log("");
    console.log("Updates the htsw CLI in place to the latest published build:");
    console.log("fetches the manifest, verifies its sha256, and replaces this binary.");
    console.log("");
    console.log("  --force   Reinstall even if already up to date.");
}
