export type BrowserEntry = {
    name: string;
    absolutePath: string;
    kind: "directory" | "importJson" | "file";
};

const JavaFile = Java.type("java.io.File");

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
        return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    return entries;
}

export function parentDirectory(path: string): string | null {
    const file = new JavaFile(String(path));
    const parent = file.isDirectory() ? file.getParentFile() : file.getParentFile();
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

function entryRank(entry: BrowserEntry): number {
    if (entry.kind === "directory") return 0;
    if (entry.kind === "importJson") return 1;
    return 2;
}
