/// <reference types="../../CTAutocomplete" />

// OS shell helpers. The process-spawning helpers (showInExplorer, openInVSCode)
// run on a daemon thread so spawning doesn't block the MC render thread.

function runDetached(args: string[]): void {
    const Thread = Java.type("java.lang.Thread");
    const Runnable = Java.type("java.lang.Runnable");
    const ProcessBuilder = Java.type("java.lang.ProcessBuilder");
    const ArrayList = Java.type("java.util.ArrayList");
    const t = new Thread(
        new Runnable({
            run: function () {
                try {
                    const list = new ArrayList();
                    for (let i = 0; i < args.length; i++) list.add(args[i]);
                    const pb = new ProcessBuilder(list);
                    pb.redirectErrorStream(true);
                    pb.start();
                } catch (_e) {
                    /* ignore */
                }
            },
        })
    );
    t.setDaemon(true);
    t.start();
}

function toWindowsPath(p: string): string {
    return String(p).replace(/\//g, "\\");
}

function isDirectory(p: string): boolean {
    const Files = Java.type("java.nio.file.Files");
    const Paths = Java.type("java.nio.file.Paths");
    try {
        return Files.isDirectory(Paths.get(String(p)));
    } catch (_e) {
        return false;
    }
}

function osFamily(): "windows" | "mac" | "linux" {
    const System = Java.type("java.lang.System");
    const name = String(System.getProperty("os.name")).toLowerCase();
    if (name.indexOf("win") >= 0) return "windows";
    if (name.indexOf("mac") >= 0 || name.indexOf("darwin") >= 0) return "mac";
    return "linux";
}

function pathExists(p: string): boolean {
    const Files = Java.type("java.nio.file.Files");
    const Paths = Java.type("java.nio.file.Paths");
    try {
        return Files.exists(Paths.get(String(p)));
    } catch (_e) {
        return false;
    }
}

function parentDir(p: string): string {
    const Paths = Java.type("java.nio.file.Paths");
    try {
        const parent = Paths.get(String(p)).getParent();
        return parent === null ? String(p) : String(parent.toString());
    } catch (_e) {
        return String(p);
    }
}

function asPathList(fullPath: string | string[]): string[] {
    if (typeof fullPath === "string") return [String(fullPath)];
    const out: string[] = [];
    for (let i = 0; i < fullPath.length; i++) out.push(String(fullPath[i]));
    return out;
}

let _GuiScreen: any = null;

export function setClipboardString(text: string): boolean {
    try {
        if (_GuiScreen === null) _GuiScreen = Java.type("net.minecraft.client.gui.GuiScreen");
        _GuiScreen.setClipboardString(String(text));
        return true;
    } catch (e) {
        try {
            ChatLib.chat(`&c[htsw] clipboard failed: ${e}`);
        } catch (_e) {
            /* ignore */
        }
        return false;
    }
}

// Opens a folder (or file) in the platform's default handler via AWT — the
// in-process path, unlike showInExplorer which shells out to select the file in
// the OS file manager. Throws if Desktop is unsupported so callers can report it.
export function openPathInOS(fullPath: string): void {
    const Desktop = Java.type("java.awt.Desktop");
    const FileClass = Java.type("java.io.File");
    Desktop.getDesktop().open(new FileClass(String(fullPath)));
}

export function revealInFilesLabel(): string {
    const fam = osFamily();
    if (fam === "mac") return "Reveal in Finder";
    if (fam === "linux") return "Show in files";
    return "Show in explorer";
}

export function showInExplorer(fullPath: string): void {
    const fam = osFamily();
    if (fam === "mac") {
        // `open -R` reveals and selects a file in Finder; a folder just opens.
        runDetached(
            isDirectory(fullPath)
                ? ["open", String(fullPath)]
                : ["open", "-R", String(fullPath)]
        );
        return;
    }
    if (fam === "linux") {
        // No portable way to select a file in the manager; open its folder.
        const dir = isDirectory(fullPath) ? String(fullPath) : parentDir(fullPath);
        runDetached(["xdg-open", dir]);
        return;
    }
    const win = toWindowsPath(fullPath);
    runDetached(
        isDirectory(fullPath) ? ["explorer.exe", win] : ["explorer.exe", `/select,${win}`]
    );
}

// macOS Minecraft is usually launched from a GUI launcher whose PATH omits
// /usr/local/bin, so `code` often isn't resolvable by name. Probe the known
// install locations and invoke the binary by absolute path instead.
function macVSCodeBinary(): string | null {
    const System = Java.type("java.lang.System");
    const home = String(System.getProperty("user.home"));
    const candidates = [
        "/usr/local/bin/code",
        "/opt/homebrew/bin/code",
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        home + "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    ];
    for (let i = 0; i < candidates.length; i++) {
        if (pathExists(candidates[i])) return candidates[i];
    }
    return null;
}

// Multiple paths open in the same window — same as `code path1 path2 …`.
export function openInVSCode(
    fullPath: string | string[],
    options?: { newWindow?: boolean }
): void {
    const paths = asPathList(fullPath);
    const newWindow = options?.newWindow === true;
    const fam = osFamily();

    if (fam === "mac") {
        const bin = macVSCodeBinary();
        if (bin !== null) {
            const args = [bin];
            if (newWindow) args.push("-n");
            runDetached(args.concat(paths));
        } else {
            // No `code` binary found; LaunchServices opens the app but can't
            // honor the new-window request.
            runDetached(["open", "-a", "Visual Studio Code"].concat(paths));
        }
        return;
    }

    if (fam === "linux") {
        const args = ["code"];
        if (newWindow) args.push("-n");
        runDetached(args.concat(paths));
        return;
    }

    // Windows: `code` is a .cmd shim; route through cmd.exe so PATH lookup finds it.
    const args = ["cmd.exe", "/c", "code"];
    if (newWindow) args.push("-n");
    runDetached(args.concat(paths));
}
