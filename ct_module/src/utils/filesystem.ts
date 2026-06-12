/**
 * Best-effort `mkdir -p` for the parent directory of `path`. Used before
 * `FileLib.write` because that call doesn't create missing parents on its
 * own — silent write failures in CT otherwise look like "the export just
 * didn't happen." Swallows errors because some FileLib builds DO create
 * dirs, in which case we'd hit a benign already-exists case from the
 * second creator.
 */
export function ensureParentDirs(path: string): void {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        const p = Paths.get(String(path));
        const parent = p.getParent();
        if (parent !== null && !Files.exists(parent)) {
            Files.createDirectories(parent);
        }
    } catch (_e) {
        // best-effort; FileLib.write may also create dirs on some builds.
    }
}

/** Recursively delete a directory (or file). Returns false when the path
 * doesn't exist or any delete failed. */
export function deleteDirRecursive(path: string): boolean {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        const root = Paths.get(String(path));
        if (!Files.exists(root)) return false;
        deleteRecursive(Files, root);
        return !Files.exists(root);
    } catch (_e) {
        return false;
    }
}

function deleteRecursive(Files: any, p: any): void {
    if (Files.isDirectory(p)) {
        const stream = Files.newDirectoryStream(p);
        try {
            const it = stream.iterator();
            while (it.hasNext()) deleteRecursive(Files, it.next());
        } finally {
            try { stream.close(); } catch (_e) { /* ignore */ }
        }
    }
    Files.deleteIfExists(p);
}

/** Count regular files under a path (the path itself if it's a file). */
export function countFilesRecursive(path: string): number {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        return countRecursive(Files, Paths.get(String(path)));
    } catch (_e) {
        return 0;
    }
}

function countRecursive(Files: any, p: any): number {
    if (!Files.exists(p)) return 0;
    if (!Files.isDirectory(p)) return 1;
    let n = 0;
    const stream = Files.newDirectoryStream(p);
    try {
        const it = stream.iterator();
        while (it.hasNext()) n += countRecursive(Files, it.next());
    } finally {
        try { stream.close(); } catch (_e) { /* ignore */ }
    }
    return n;
}

export function encodeFilesystemComponent(
    value: string,
    options: { escapeDots?: boolean } = {}
): string {
    let out = "";
    for (let i = 0; i < value.length; i++) {
        const ch = value.charAt(i);
        const code = value.charCodeAt(i);
        const safe =
            (code >= 0x30 && code <= 0x39) ||
            (code >= 0x41 && code <= 0x5a) ||
            (code >= 0x61 && code <= 0x7a) ||
            ch === "-" ||
            ch === "_" ||
            (ch === "." && options.escapeDots !== true);

        if (safe) {
            out += ch;
        } else {
            // ES5 lib: no String.prototype.padStart in ChatTriggers.
            let hex = code.toString(16);
            while (hex.length < 4) hex = "0" + hex;
            out += "_" + hex;
        }
    }
    return out;
}
