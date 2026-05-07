/// <reference types="../../CTAutocomplete" />

// Fire-and-forget OS shell helpers. Run on a daemon thread so the MC render thread isn't
// blocked by spawning processes.

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

export function showInExplorer(fullPath: string): void {
    const win = toWindowsPath(fullPath);
    if (isDirectory(fullPath)) {
        runDetached(["explorer.exe", win]);
    } else {
        runDetached(["explorer.exe", `/select,${win}`]);
    }
}

export function openInVSCode(fullPath: string | string[]): void {
    // `code` is a .cmd shim on Windows; route through cmd.exe so PATH lookup finds it.
    // Multiple paths open in the same VSCode window — same as `code path1 path2 …`.
    const args: string[] = ["cmd.exe", "/c", "code"];
    if (typeof fullPath === "string") {
        args.push(String(fullPath));
    } else {
        for (let i = 0; i < fullPath.length; i++) args.push(String(fullPath[i]));
    }
    runDetached(args);
}
