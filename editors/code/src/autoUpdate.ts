import { commands, ExtensionContext, ProgressLocation, Uri, window, workspace } from "vscode";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { download, fetchText } from "./http";
import { errorMessage } from "./errorMessage";

const BASE_URL = "https://legendarygames.dev/htsw/vscode";
const MANIFEST_URL = `${BASE_URL}/latest.json`;

interface Manifest {
    version: string;
    vsix: string;
    sha256: string;
    notes?: string;
}

interface CheckForUpdatesOptions {
    manual?: boolean;
}

export async function checkForUpdates(context: ExtensionContext, options: CheckForUpdatesOptions = {}): Promise<void> {
    if (!options.manual && !workspace.getConfiguration("htsw").get<boolean>("autoUpdate.enabled", true)) {
        return;
    }

    const current = context.extension.packageJSON.version as string;
    let manifest: Manifest;
    try {
        manifest = parseManifest(await fetchText(MANIFEST_URL));
    } catch (err) {
        if (options.manual) {
            void window.showErrorMessage(`HTSW++ update check failed: ${errorMessage(err)}`);
        }
        return;
    }

    if (!isNewer(manifest.version, current)) {
        if (options.manual) {
            void window.showInformationMessage(`HTSW++ is up to date (${current}).`);
        }
        return;
    }

    const choice = await window.showInformationMessage(
        updatePrompt(manifest, current),
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
                    const hash = await download(`${BASE_URL}/${manifest.vsix}`, vsixPath, "sha256");
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
        void window.showErrorMessage(`HTSW++ update failed: ${errorMessage(err)}`);
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
    if (typeof m.notes !== "string") delete m.notes;
    return m as Manifest;
}

function updatePrompt(manifest: Manifest, current: string): string {
    const notes = manifest.notes?.trim();
    const base = `HTSW++ ${manifest.version} is available (you have ${current}).`;
    return notes ? `${base}\n\nRelease notes: ${notes}` : base;
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
