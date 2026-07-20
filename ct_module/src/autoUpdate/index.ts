/// <reference types="../../CTAutocomplete" />

import {
    getAutoUpdatePreference,
    setAutoUpdatePreference,
    type AutoUpdatePreference,
} from "../settings";
import { javaType, runtimeString, type RuntimeString } from "../utils/java";

const MODULE_DIR = "./config/ChatTriggers/modules/HTSW";
const BASE_URL = "https://legendarygames.dev/htsw/ct";
const MANIFEST_URL = BASE_URL + "/latest.json";
const USER_AGENT = "HTSW-CT-Updater";
const LOCAL_STATE_FILES = [
    ".env",
    "gui-settings.json",
    "gui-recents.json",
    "gui-onboarding.json",
    "gui-housing.json",
    "gui-open-target.json",
    "gui-debug.log",
];

type Manifest = { version: string; zip: string; sha256: string; notes?: string };
type UpdateOptions = {
    checkOnly: boolean;
    notifyWhenCurrent: boolean;
    notifyOnFailure: boolean;
};

let updateInProgress = false;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

export function initAutoUpdate(): void {
    const preference = getAutoUpdatePreference();
    if (preference === "unset") {
        showAutoUpdatePrompt();
        return;
    }
    if (preference === "disabled") return;
    startAutoUpdate({
        checkOnly: false,
        notifyWhenCurrent: false,
        notifyOnFailure: false,
    });
}

export function commandUpdate(args: string[]): void {
    const command = args.length === 0 ? "" : args[0].toLowerCase();
    if (args.length > 1 || !isUpdateCommand(command)) {
        ChatLib.chat("&cUsage: /htsw update [check|status|enable|disable]");
        return;
    }

    if (command === "status") {
        printAutoUpdateStatus();
        return;
    }

    if (command === "enable" || command === "on" || command === "accept") {
        setAutoUpdatePreference("enabled");
        ChatLib.chat("&a[htsw] Auto-updates enabled.");
        startAutoUpdate({
            checkOnly: false,
            notifyWhenCurrent: true,
            notifyOnFailure: true,
        });
        return;
    }

    if (command === "disable" || command === "off" || command === "decline") {
        setAutoUpdatePreference("disabled");
        ChatLib.chat(
            "&7[htsw] Auto-updates disabled. Manual &f/htsw update&7 still works."
        );
        return;
    }

    startAutoUpdate({
        checkOnly: command === "check",
        notifyWhenCurrent: true,
        notifyOnFailure: true,
    });
}

function isUpdateCommand(command: string): boolean {
    return (
        command === "" ||
        command === "check" ||
        command === "status" ||
        command === "enable" ||
        command === "on" ||
        command === "accept" ||
        command === "disable" ||
        command === "off" ||
        command === "decline"
    );
}

function showAutoUpdatePrompt(): void {
    ChatLib.chat("&e&lHTSW auto-updates are available.");
    ChatLib.chat(
        "&7Allow HTSW to check for and install CT module updates when it loads?"
    );
    ChatLib.chat(
        new Message([
            commandLink(
                "&a[Enable]",
                "/htsw update enable",
                "&7Enable auto-updates and check now."
            ),
            " ",
            commandLink(
                "&c[Disable]",
                "/htsw update disable",
                "&7Keep automatic checks off."
            ),
            " ",
            commandLink("&8[Status]", "/htsw update status", "&7Show updater status."),
        ])
    );
}

function commandLink(label: string, command: string, hover: string): TextComponent {
    return new TextComponent(label)
        .setClick("run_command", command)
        .setHover("show_text", hover);
}

function printAutoUpdateStatus(): void {
    const preference = getAutoUpdatePreference();
    const status = formatPreference(preference);
    const version = readLocalVersion();
    ChatLib.chat(`&7[htsw] Auto-update: ${status}&7.`);
    ChatLib.chat(
        `&7[htsw] Installed version: &f${version === null ? "unknown" : version}&7.`
    );
    if (preference === "unset") {
        ChatLib.chat(
            "&7Run &f/htsw update enable&7 or &f/htsw update disable&7 to choose."
        );
    } else {
        ChatLib.chat(
            "&7Run &f/htsw update check&7 to check without changing this setting."
        );
    }
}

function formatPreference(preference: AutoUpdatePreference): string {
    if (preference === "enabled") return "&aenabled";
    if (preference === "disabled") return "&cdisabled";
    return "&eunset";
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
        const Thread = javaType("java.lang.Thread");
        const Runnable = javaType("java.lang.Runnable");
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
        const value: RuntimeString | null | undefined = FileLib.read(
            MODULE_DIR + "/metadata.json"
        );
        const raw = runtimeString(value);
        if (raw.length === 0) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return null;
        const v = parsed.version;
        return typeof v === "string" ? v : null;
    } catch (_e) {
        return null;
    }
}

function fetchManifest(): Manifest | null {
    try {
        const value: RuntimeString | null | undefined = FileLib.getUrlContent(
            MANIFEST_URL,
            USER_AGENT
        );
        const raw = runtimeString(value);
        if (raw.length === 0 || raw.charAt(0) !== "{") return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return null;
        if (
            typeof parsed.version !== "string" ||
            typeof parsed.zip !== "string" ||
            typeof parsed.sha256 !== "string"
        ) {
            return null;
        }
        return {
            version: parsed.version,
            zip: parsed.zip,
            sha256: parsed.sha256,
            ...(typeof parsed.notes === "string" ? { notes: parsed.notes } : {}),
        };
    } catch (_e) {
        return null;
    }
}

function showReleaseNotes(manifest: Manifest): void {
    const notes = manifest.notes?.trim();
    if (!notes) return;
    const lines = releaseNoteLines(notes);
    if (lines.length === 0) return;
    ChatLib.chat("&7Release notes:");
    for (let i = 0; i < lines.length && i < 4; i++) {
        chatLineWithLinks("&7- &f", lines[i]);
    }
}

function releaseNoteLines(notes: string): string[] {
    const rawLines = notes.replace(/\r/g, "").split("\n");
    const lines: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
        const line = normalizeReleaseNoteLine(rawLines[i]);
        if (line !== null) lines.push(line);
    }
    return lines;
}

function normalizeReleaseNoteLine(line: string): string | null {
    let text = line.trim();
    if (text.length === 0) return null;
    text = text.replace(/^#+\s*/, "");
    text = text.replace(/^[-*]\s+/, "");
    text = text.replace(/\*\*/g, "");
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 $2");
    if (
        /^Full Changelog:\s*https:\/\/github\.com\/LGHousing\/htsw\/compare\//i.test(text)
    ) {
        return null;
    }
    return text;
}

function chatLineWithLinks(prefix: string, text: string): void {
    const regex = /https?:\/\/[^\s]+/g;
    const parts = [prefix] as Array<string | TextComponent>;
    let last = 0;
    let match: RegExpExecArray | null = regex.exec(text);
    while (match !== null) {
        if (match.index > last) parts.push(text.substring(last, match.index));
        const link = splitTrailingUrlPunctuation(match[0]);
        parts.push(urlLink(link.url));
        if (link.trailing.length > 0) parts.push(link.trailing);
        last = match.index + match[0].length;
        match = regex.exec(text);
    }
    if (last < text.length) parts.push(text.substring(last));
    ChatLib.chat(new Message(parts));
}

function splitTrailingUrlPunctuation(rawUrl: string): { url: string; trailing: string } {
    let url = rawUrl;
    let trailing = "";
    while (url.length > 0) {
        const ch = url.charAt(url.length - 1);
        if (".,)]".indexOf(ch) === -1) break;
        trailing = ch + trailing;
        url = url.substring(0, url.length - 1);
    }
    return { url, trailing };
}

function urlLink(url: string): TextComponent {
    return new TextComponent("&b[link]")
        .setClick("open_url", url)
        .setHover("show_text", `&7Open ${url}`);
}

function download(url: string, destPath: string): boolean {
    try {
        const URL = javaType("java.net.URL");
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        const StandardCopyOption = javaType("java.nio.file.StandardCopyOption");

        const dest = Paths.get(destPath);
        const parent = dest.getParent();
        if (parent !== null) Files.createDirectories(parent);

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
    const Files = javaType("java.nio.file.Files");
    const Paths = javaType("java.nio.file.Paths");
    const MessageDigest = javaType("java.security.MessageDigest");

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
    const FileInputStream = javaType("java.io.FileInputStream");
    const ZipInputStream = javaType("java.util.zip.ZipInputStream");
    const Files = javaType("java.nio.file.Files");
    const Paths = javaType("java.nio.file.Paths");
    const StandardCopyOption = javaType("java.nio.file.StandardCopyOption");

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
                const parent = target.getParent();
                if (parent === null) return false;
                Files.createDirectories(parent);
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
    const Files = javaType("java.nio.file.Files");
    const Paths = javaType("java.nio.file.Paths");
    const StandardCopyOption = javaType("java.nio.file.StandardCopyOption");
    let moduleRoot: HtswJavaPath | undefined;
    let backupRoot: HtswJavaPath | undefined;
    try {
        moduleRoot = Paths.get(MODULE_DIR).toAbsolutePath().normalize();
        let stagedRoot = Paths.get(stagedDir).toAbsolutePath().normalize();
        // The manual-install zip wraps the payload in an HTSW/ folder; the feed
        // zip does not. Descend into the wrapper when present so either archive
        // lands its files directly in the module dir.
        const wrapped = stagedRoot.resolve("HTSW");
        if (Files.isDirectory(wrapped)) stagedRoot = wrapped;

        // Park the old module in .update/backup instead of deleting it, so a
        // failure mid-swap can roll back to a working module. The caller
        // deletes the whole .update dir afterward in every outcome.
        const updateRoot = stagedRoot.getParent();
        if (updateRoot === null) return false;
        backupRoot = updateRoot.resolve("backup");
        Files.createDirectories(backupRoot);

        moveChildren(Files, StandardCopyOption, moduleRoot, backupRoot, ".update", false);
        moveChildren(Files, StandardCopyOption, stagedRoot, moduleRoot, null, false);
        restoreLocalState(Files, StandardCopyOption, backupRoot, moduleRoot);
        return true;
    } catch (_e) {
        try {
            if (moduleRoot !== undefined && backupRoot !== undefined) {
                moveChildren(
                    Files,
                    StandardCopyOption,
                    backupRoot,
                    moduleRoot,
                    null,
                    true
                );
            }
        } catch (_e2) {
            // Rollback itself failed; leave the disk state for manual repair.
        }
        return false;
    }
}

function restoreLocalState(
    Files: HtswJavaFilesClass,
    StandardCopyOption: HtswJavaCopyOptionsClass,
    backupRoot: HtswJavaPath,
    moduleRoot: HtswJavaPath
): void {
    for (let i = 0; i < LOCAL_STATE_FILES.length; i++) {
        const source = backupRoot.resolve(LOCAL_STATE_FILES[i]);
        if (!Files.exists(source)) continue;
        const target = moduleRoot.resolve(LOCAL_STATE_FILES[i]);
        deleteNioPath(Files, target);
        Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
    }
}

function moveChildren(
    Files: HtswJavaFilesClass,
    StandardCopyOption: HtswJavaCopyOptionsClass,
    from: HtswJavaPath,
    to: HtswJavaPath,
    skipName: string | null,
    clobber: boolean
): void {
    const stream = Files.newDirectoryStream(from);
    try {
        const it = stream.iterator();
        while (it.hasNext()) {
            const child = it.next();
            const childName = child.getFileName();
            if (childName === null) continue;
            if (skipName !== null && String(childName.toString()) === skipName) {
                continue;
            }
            const target = to.resolve(childName);
            // Files.move REPLACE_EXISTING can't replace a non-empty directory,
            // so the rollback pass deletes partially-moved targets first.
            if (clobber) deleteNioPath(Files, target);
            Files.move(child, target, StandardCopyOption.REPLACE_EXISTING);
        }
    } finally {
        stream.close();
    }
}

function deleteNioPath(Files: HtswJavaFilesClass, path: HtswJavaPath): void {
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
    const parts = v.split(".");
    const out: number[] = [];
    for (let i = 0; i < parts.length; i++) {
        const n = parseInt(parts[i], 10);
        out.push(isNaN(n) ? 0 : n);
    }
    return out;
}
