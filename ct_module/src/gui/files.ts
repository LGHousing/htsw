export type BrowserEntry = {
    name: string;
    absolutePath: string;
    kind: "directory" | "importJson" | "file";
};

const JavaFile = Java.type("java.io.File");

export function minecraftHtswRoot(): string {
    return String(new JavaFile("./htsw").getAbsolutePath());
}

export function defaultImportJsonPath(): string {
    return String(new JavaFile(minecraftHtswRoot(), "import.json").getAbsolutePath());
}

export function resolveHtswHomePath(path: string): string {
    const trimmed = String(path).trim();
    if (trimmed.length === 0) return defaultImportJsonPath();
    const file = new JavaFile(trimmed);
    if (file.isAbsolute()) return String(file.getAbsolutePath());
    return String(new JavaFile(minecraftHtswRoot(), trimmed).getAbsolutePath());
}

export function listBrowserEntries(directory: string): BrowserEntry[] {
    const dir = new JavaFile(String(directory));
    const files = dir.exists() && dir.isDirectory() ? dir.listFiles() : [];
    const entries: BrowserEntry[] = [];

    for (const file of files) {
        const name = String(file.getName());
        const isDirectory = Boolean(file.isDirectory());
        const isJson = name.toLowerCase().endsWith(".json");
        if (!isDirectory && !isJson) continue;

        entries.push({
            name,
            absolutePath: String(file.getAbsolutePath()),
            kind: isDirectory
                ? "directory"
                : name.toLowerCase() === "import.json"
                  ? "importJson"
                  : "file",
        });
    }

    entries.sort((a, b) => {
        const rank = entryRank(a) - entryRank(b);
        if (rank !== 0) return rank;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    return entries;
}

export function parentDirectory(path: string): string | null {
    const file = new JavaFile(String(path));
    const parent = file.getParentFile();
    if (parent === null) return null;
    return String(parent.getAbsolutePath());
}

export function directoryForPath(path: string): string {
    const file = new JavaFile(String(path));
    const dir = file.isDirectory() ? file : file.getParentFile();
    if (dir === null) return String(new JavaFile(".").getAbsolutePath());
    return String(dir.getAbsolutePath());
}

export function normalizePathForDisplay(path: string): string {
    try {
        return String(new JavaFile(String(path)).getCanonicalPath());
    } catch {
        return path;
    }
}

export function displayPathFromHtswHome(path: string): string {
    try {
        const root = String(new JavaFile(minecraftHtswRoot()).getCanonicalPath()).replace(
            /\\/g,
            "/"
        );
        const full = String(new JavaFile(String(path)).getCanonicalPath()).replace(
            /\\/g,
            "/"
        );
        if (full === root) return ".";
        if (full.startsWith(root + "/")) return full.slice(root.length + 1);
        return String(path);
    } catch {
        return path;
    }
}

function entryRank(entry: BrowserEntry): number {
    if (entry.kind === "directory") return 0;
    if (entry.kind === "importJson") return 1;
    return 2;
}

export function joinPath(parent: string, name: string): string {
    return String(new JavaFile(String(parent), String(name)).getAbsolutePath());
}

export function createDirectory(path: string): { ok: boolean; error?: string } {
    try {
        const file = new JavaFile(String(path));
        if (file.exists()) {
            return { ok: false, error: "Already exists" };
        }
        const created = Boolean(file.mkdirs());
        if (!created && !file.exists()) {
            return { ok: false, error: "mkdirs failed" };
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}

export function createFile(
    path: string,
    contents: string
): { ok: boolean; error?: string } {
    try {
        const file = new JavaFile(String(path));
        if (file.exists()) {
            return { ok: false, error: "Already exists" };
        }
        const parent = file.getParentFile();
        if (parent !== null && !parent.exists()) {
            parent.mkdirs();
        }
        FileLib.write(String(path), String(contents), true);
        if (!file.exists()) {
            return { ok: false, error: "write failed" };
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}

/**
 * Recursively delete a file or directory. Refuses to operate on anything
 * outside the htsw root, or on the htsw root itself, as a typo guard.
 */
export function deletePathRecursive(path: string): { ok: boolean; error?: string } {
    try {
        const root = String(new JavaFile(minecraftHtswRoot()).getCanonicalPath()).replace(
            /\\/g,
            "/"
        );
        const target = String(new JavaFile(String(path)).getCanonicalPath()).replace(
            /\\/g,
            "/"
        );
        if (target === root) {
            return { ok: false, error: "Refuse to delete htsw root" };
        }
        if (!target.startsWith(root + "/")) {
            return { ok: false, error: "Path is outside htsw root" };
        }
        const file = new JavaFile(target);
        if (!file.exists()) {
            return { ok: false, error: "Not found" };
        }
        if (!deleteRecursively(file)) {
            return { ok: false, error: "Delete failed" };
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}

function deleteRecursively(file: any): boolean {
    if (Boolean(file.isDirectory())) {
        const children = file.listFiles();
        if (children !== null) {
            for (let i = 0; i < children.length; i++) {
                if (!deleteRecursively(children[i])) return false;
            }
        }
    }
    return Boolean(file["delete"]());
}

/**
 * Open the OS file explorer at `directory`. Fire-and-forget; we deliberately
 * do not waitFor() because Windows explorer.exe exits with code 1 even on
 * success.
 */
export function openDirectoryInOSFileExplorer(directory: string): {
    ok: boolean;
    error?: string;
} {
    try {
        const SystemClass = Java.type("java.lang.System");
        const ProcessBuilder = Java.type("java.lang.ProcessBuilder");
        const ArrayList = Java.type("java.util.ArrayList");

        const osName = String(SystemClass.getProperty("os.name") ?? "").toLowerCase();
        const args = new ArrayList();
        if (osName.indexOf("win") === 0) {
            args.add("explorer.exe");
        } else if (osName.indexOf("mac") === 0 || osName.indexOf("darwin") >= 0) {
            args.add("open");
        } else {
            args.add("xdg-open");
        }
        args.add(String(directory));
        const pb = new ProcessBuilder(args);
        pb.start();
        return { ok: true };
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}
