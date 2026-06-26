/// <reference types="../../CTAutocomplete" />

export const MODULE_DIR = "./config/ChatTriggers/modules/HTSW";
const BASE_URL = "https://legendarygames.dev/htsw/ct";
const MANIFEST_URL = BASE_URL + "/latest.json";
const USER_AGENT = "HTSW-CT-Updater";

type Manifest = { version: string; zip: string; sha256: string; notes?: string };
type UpdateOptions = {
    checkOnly: boolean;
    notifyWhenCurrent: boolean;
    notifyOnFailure: boolean;
};

let updateInProgress = false;

export function initAutoUpdate(): void {
    startAutoUpdate({
        checkOnly: false,
        notifyWhenCurrent: false,
        notifyOnFailure: false,
    });
}

export function commandUpdate(args: string[]): void {
    if (args.length > 0 && args[0] !== "check" && args[0] !== "status") {
        ChatLib.chat("&cUsage: /htsw update [check]");
        return;
    }

    startAutoUpdate({
        checkOnly: args.length > 0,
        notifyWhenCurrent: true,
        notifyOnFailure: true,
    });
}

function startAutoUpdate(options: UpdateOptions): void {
    if (updateInProgress) {
        if (options.notifyWhenCurrent || options.notifyOnFailure) {
            ChatLib.chat("&eHTSW update check is already running.");
        }
        return;
    }

    updateInProgress = true;
    try {
        const Thread = Java.type("java.lang.Thread");
        const Runnable = Java.type("java.lang.Runnable");
        const t = new Thread(
            new Runnable({
                run: function () {
                    try {
                        runUpdateCheck(options);
                    } catch (_e) {
                        reportUpdateFailure(options, "unexpected updater error");
                    } finally {
                        updateInProgress = false;
                    }
                },
            })
        );
        t.setDaemon(true);
        t.start();
    } catch (e) {
        updateInProgress = false;
        reportUpdateFailure(options, String(e));
    }
}

function runUpdateCheck(options: UpdateOptions): void {
    const local = readLocalVersion();
    if (local === null) {
        reportUpdateFailure(options, "could not read local metadata.json");
        return;
    }

    const manifest = fetchManifest();
    if (manifest === null) {
        reportUpdateFailure(options, "could not fetch update manifest");
        return;
    }
    if (!isNewer(manifest.version, local)) {
        if (options.notifyWhenCurrent) {
            ChatLib.chat(`&aHTSW is up to date &7(&f${local}&7).`);
        }
        return;
    }

    if (options.checkOnly) {
        ChatLib.chat(
            `&eHTSW &f${manifest.version}&e is available &7(you have &f${local}&7). ` +
            "&7Run &f/htsw update&7 to install."
        );
        showReleaseNotes(manifest);
        return;
    }

    ChatLib.chat(`&e&lHTSW &7updating &f${local} &7→ &a${manifest.version}&7...`);

    const updateDir = MODULE_DIR + "/.update";
    const zipPath = updateDir + "/" + manifest.zip;
    if (!download(BASE_URL + "/" + manifest.zip, zipPath)) {
        reportUpdateFailure(options, "could not download archive");
        return;
    }

    const actual = sha256Hex(zipPath);
    if (actual.toLowerCase() !== manifest.sha256.toLowerCase()) {
        reportUpdateFailure(options, "checksum mismatch");
        deletePath(updateDir);
        return;
    }

    const stagedDir = updateDir + "/next";
    if (!unzipInto(zipPath, stagedDir) || !replaceModuleContents(stagedDir)) {
        reportUpdateFailure(options, "extraction failed");
        deletePath(updateDir);
        return;
    }

    deletePath(updateDir);
    ChatLib.chat(
        `&aHTSW updated to &f${manifest.version}&a. Run &e/ct reload&a to apply.`
    );
    showReleaseNotes(manifest);
}

function reportUpdateFailure(options: UpdateOptions, reason: string): void {
    if (options.notifyOnFailure) {
        ChatLib.chat(`&cHTSW update failed: ${reason}.`);
    }
}

export function readLocalVersion(): string | null {
    try {
        const raw = String(FileLib.read(MODULE_DIR + "/metadata.json") || "");
        if (raw.length === 0) return null;
        const v = JSON.parse(raw).version;
        return typeof v === "string" ? v : null;
    } catch (_e) {
        return null;
    }
}

function fetchManifest(): Manifest | null {
    try {
        const raw = String(FileLib.getUrlContent(MANIFEST_URL, USER_AGENT) || "");
        if (raw.length === 0 || raw.charAt(0) !== "{") return null;
        const parsed = JSON.parse(raw);
        if (
            typeof parsed.version !== "string" ||
            typeof parsed.zip !== "string" ||
            typeof parsed.sha256 !== "string"
        ) {
            return null;
        }
        const manifest = parsed as Manifest;
        if (typeof manifest.notes !== "string") delete manifest.notes;
        return manifest;
    } catch (_e) {
        return null;
    }
}

function showReleaseNotes(manifest: Manifest): void {
    const notes = manifest.notes?.trim();
    if (!notes) return;
    ChatLib.chat(`&7Release notes: &f${notes}`);
}

function download(url: string, destPath: string): boolean {
    try {
        const URL = Java.type("java.net.URL");
        const Files = Java.type("java.nio.file.Files");
        const Paths = Java.type("java.nio.file.Paths");
        const StandardCopyOption = Java.type("java.nio.file.StandardCopyOption");

        const dest = Paths.get(destPath);
        Files.createDirectories(dest.getParent());

        const conn = new URL(url).openConnection();
        conn.setRequestProperty("User-Agent", USER_AGENT);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        const input = conn.getInputStream();
        try {
            Files.copy(input, dest, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            input.close();
        }
        return true;
    } catch (_e) {
        return false;
    }
}

function sha256Hex(path: string): string {
    const Files = Java.type("java.nio.file.Files");
    const Paths = Java.type("java.nio.file.Paths");
    const MessageDigest = Java.type("java.security.MessageDigest");

    const bytes = Files.readAllBytes(Paths.get(path));
    const digest = MessageDigest.getInstance("SHA-256").digest(bytes);

    let hex = "";
    for (let i = 0; i < digest.length; i++) {
        const b = digest[i] & 0xff;
        if (b < 0x10) hex += "0";
        hex += b.toString(16);
    }
    return hex;
}

function unzipInto(zipPath: string, destDir: string): boolean {
    const FileInputStream = Java.type("java.io.FileInputStream");
    const ZipInputStream = Java.type("java.util.zip.ZipInputStream");
    const Files = Java.type("java.nio.file.Files");
    const Paths = Java.type("java.nio.file.Paths");
    const StandardCopyOption = Java.type("java.nio.file.StandardCopyOption");

    const destRoot = Paths.get(destDir).toAbsolutePath().normalize();
    const zis = new ZipInputStream(new FileInputStream(zipPath));
    try {
        let entry = zis.getNextEntry();
        while (entry !== null) {
            const name = String(entry.getName());
            const target = destRoot.resolve(name).normalize();
            if (!target.startsWith(destRoot)) {
                // zip-slip guard: skip entries that escape the module dir.
                entry = zis.getNextEntry();
                continue;
            }
            if (entry.isDirectory()) {
                Files.createDirectories(target);
            } else {
                Files.createDirectories(target.getParent());
                Files.copy(zis, target, StandardCopyOption.REPLACE_EXISTING);
            }
            zis.closeEntry();
            entry = zis.getNextEntry();
        }
        return true;
    } catch (_e) {
        return false;
    } finally {
        try {
            zis.close();
        } catch (_e2) {
            // ignore
        }
    }
}

function replaceModuleContents(stagedDir: string): boolean {
    const Files = Java.type("java.nio.file.Files");
    const Paths = Java.type("java.nio.file.Paths");
    const StandardCopyOption = Java.type("java.nio.file.StandardCopyOption");
    let moduleRoot: any;
    let backupRoot: any;
    try {
        moduleRoot = Paths.get(MODULE_DIR).toAbsolutePath().normalize();
        const stagedRoot = Paths.get(stagedDir).toAbsolutePath().normalize();

        // Park the old module in .update/backup instead of deleting it, so a
        // failure mid-swap can roll back to a working module. The caller
        // deletes the whole .update dir afterward in every outcome.
        backupRoot = stagedRoot.getParent().resolve("backup");
        Files.createDirectories(backupRoot);

        moveChildren(Files, StandardCopyOption, moduleRoot, backupRoot, ".update", false);
        moveChildren(Files, StandardCopyOption, stagedRoot, moduleRoot, null, false);
        return true;
    } catch (_e) {
        try {
            if (moduleRoot !== undefined && backupRoot !== undefined) {
                moveChildren(Files, StandardCopyOption, backupRoot, moduleRoot, null, true);
            }
        } catch (_e2) {
            // Rollback itself failed; leave the disk state for manual repair.
        }
        return false;
    }
}

function moveChildren(
    Files: any,
    StandardCopyOption: any,
    from: any,
    to: any,
    skipName: string | null,
    clobber: boolean
): void {
    const stream = Files.newDirectoryStream(from);
    try {
        const it = stream.iterator();
        while (it.hasNext()) {
            const child = it.next();
            if (skipName !== null && String(child.getFileName().toString()) === skipName) {
                continue;
            }
            const target = to.resolve(child.getFileName());
            // Files.move REPLACE_EXISTING can't replace a non-empty directory,
            // so the rollback pass deletes partially-moved targets first.
            if (clobber) deleteNioPath(Files, target);
            Files.move(child, target, StandardCopyOption.REPLACE_EXISTING);
        }
    } finally {
        stream.close();
    }
}

function deleteNioPath(Files: any, path: any): void {
    if (Files.isDirectory(path)) {
        const stream = Files.newDirectoryStream(path);
        try {
            const it = stream.iterator();
            while (it.hasNext()) deleteNioPath(Files, it.next());
        } finally {
            stream.close();
        }
    }
    Files.deleteIfExists(path);
}

function deletePath(path: string): void {
    try {
        FileLib.deleteDirectory(path);
    } catch (_e) {
        // ignore
    }
}

function isNewer(remote: string, local: string): boolean {
    const a = parseVersion(remote);
    const b = parseVersion(local);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const av = i < a.length ? a[i] : 0;
        const bv = i < b.length ? b[i] : 0;
        if (av > bv) return true;
        if (av < bv) return false;
    }
    return false;
}

function parseVersion(v: string): number[] {
    const parts = String(v).split(".");
    const out: number[] = [];
    for (let i = 0; i < parts.length; i++) {
        const n = parseInt(parts[i], 10);
        out.push(isNaN(n) ? 0 : n);
    }
    return out;
}
