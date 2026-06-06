import { commands, ExtensionContext, ProgressLocation, Uri, window, workspace } from "vscode";
import { get } from "node:https";
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE_URL = "https://legendarygames.dev/htsw/vscode";
const MANIFEST_URL = `${BASE_URL}/latest.json`;
const REQUEST_TIMEOUT_MS = 30000;

interface Manifest {
    version: string;
    vsix: string;
    sha256: string;
}

export async function checkForUpdates(context: ExtensionContext): Promise<void> {
    if (!workspace.getConfiguration("htsw").get<boolean>("autoUpdate.enabled", true)) {
        return;
    }

    const current = context.extension.packageJSON.version as string;
    let manifest: Manifest;
    try {
        manifest = parseManifest(await fetchText(MANIFEST_URL));
    } catch {
        return;
    }

    if (!isNewer(manifest.version, current)) return;

    const choice = await window.showInformationMessage(
        `HTSW++ ${manifest.version} is available (you have ${current}).`,
        "Update",
        "Later"
    );
    if (choice !== "Update") return;

    try {
        await window.withProgress(
            { location: ProgressLocation.Notification, title: `Updating HTSW++ to ${manifest.version}…` },
            async () => {
                const vsixPath = join(tmpdir(), manifest.vsix);
                try {
                    const hash = await download(`${BASE_URL}/${manifest.vsix}`, vsixPath);
                    if (hash.toLowerCase() !== manifest.sha256.toLowerCase()) {
                        throw new Error("checksum mismatch");
                    }
                    await commands.executeCommand("workbench.extensions.installExtension", Uri.file(vsixPath));
                } finally {
                    await fs.rm(vsixPath, { force: true });
                }
            }
        );
    } catch (err) {
        void window.showErrorMessage(`HTSW++ update failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }

    const reload = await window.showInformationMessage(
        `HTSW++ updated to ${manifest.version}. Reload to apply.`,
        "Reload Window"
    );
    if (reload === "Reload Window") {
        await commands.executeCommand("workbench.action.reloadWindow");
    }
}

function parseManifest(text: string): Manifest {
    const m = JSON.parse(text) as Partial<Manifest>;
    if (typeof m.version !== "string" || typeof m.vsix !== "string" || typeof m.sha256 !== "string") {
        throw new Error("malformed manifest");
    }
    return m as Manifest;
}

function fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve(body));
        });
        req.on("error", reject);
        req.setTimeout(REQUEST_TIMEOUT_MS, () =>
            req.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`))
        );
    });
}

function download(url: string, destPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const hash = createHash("sha256");
            const file = createWriteStream(destPath);
            res.on("data", (chunk) => hash.update(chunk));
            res.pipe(file);
            file.on("finish", () => file.close(() => resolve(hash.digest("hex"))));
            file.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(REQUEST_TIMEOUT_MS, () =>
            req.destroy(new Error(`download timed out after ${REQUEST_TIMEOUT_MS}ms`))
        );
    });
}

function isNewer(remote: string, current: string): boolean {
    const a = remote.split(".").map((n) => parseInt(n, 10) || 0);
    const b = current.split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const av = a[i] ?? 0;
        const bv = b[i] ?? 0;
        if (av > bv) return true;
        if (av < bv) return false;
    }
    return false;
}
