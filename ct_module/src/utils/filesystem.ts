import { javaType, runtimeString, type RuntimeString } from "./java";

export function readTextFileOrNull(path: string): string | null {
    if (!FileLib.exists(path)) return null;
    const value = FileLib.read(path) as unknown as string | null | undefined;
    return value === null || value === undefined ? null : value;
}

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
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        const p = Paths.get(runtimeString(path));
        const parent = p.getParent();
        if (parent !== null && !Files.exists(parent)) {
            Files.createDirectories(parent);
        }
    } catch (_e) {
        // best-effort; FileLib.write may also create dirs on some builds.
    }
}

// Unique per write: two processes writing the same target (the shared-cache
// scenario this exists for) must not collide on one temp name, or the moves
// can publish each other's half-written temp.
let tempWriteCounter = 0;

export function atomicWriteText(
    path: string,
    content: string,
    options: { replaceExisting?: boolean } = {}
): boolean {
    const tempPath = `${path}.${Date.now().toString(36)}-${++tempWriteCounter}.tmp`;
    const replaceExisting = options.replaceExisting !== false;
    if (writeTempThenMove(path, tempPath, content, replaceExisting)) return true;
    if (!replaceExisting) return false;
    try {
        FileLib.write(path, content, true);
        const written = FileLib.read(path) as RuntimeString | null | undefined;
        return runtimeString(written) === content;
    } catch (_fallbackError) {
        return false;
    }
}

function writeTempThenMove(
    path: string,
    tempPath: string,
    content: string,
    replaceExisting: boolean
): boolean {
    try {
        ensureParentDirs(path);
        FileLib.write(tempPath, content, true);
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        const StandardCopyOption = javaType("java.nio.file.StandardCopyOption");
        const temp = Paths.get(runtimeString(tempPath));
        const target = Paths.get(runtimeString(path));
        if (replaceExisting) {
            if (
                tryFilesystemMove(() => {
                    Files.move(
                        temp,
                        target,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING
                    );
                })
            )
                return true;
            if (
                tryFilesystemMove(() => {
                    Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
                })
            )
                return true;
        } else if (
            tryFilesystemMove(() => {
                Files.move(temp, target);
            })
        )
            return true;
        // Both moves failed; the unique-named temp would otherwise pile up.
        try {
            Files.deleteIfExists(temp);
        } catch (_cleanupError) {
            // litter is acceptable, a throw here is not
        }
        return false;
    } catch (_tempWriteOrInteropError) {
        return false;
    }
}

function tryFilesystemMove(move: () => void): boolean {
    try {
        move();
        return true;
    } catch (_moveError) {
        return false;
    }
}

// Cache the type lookups: getMtimeMs is called in tight loops (mtime
// watcher, parse-cache fingerprint check) over hundreds of files, and
// `Java.type` is not free.
let _Paths: HtswJavaPathsClass | null = null;
let _Files: HtswJavaFilesClass | null = null;

function nioPath(path: string): HtswJavaPath {
    if (_Paths === null) _Paths = javaType("java.nio.file.Paths");
    return _Paths.get(runtimeString(path));
}

function nioFiles(): HtswJavaFilesClass {
    if (_Files === null) _Files = javaType("java.nio.file.Files");
    return _Files;
}

/** Last-modified time in ms, or 0 when the file is missing or unreadable. */
export function getMtimeMs(path: string): number {
    try {
        return Number(nioFiles().getLastModifiedTime(nioPath(path)).toMillis());
    } catch (_e) {
        return 0;
    }
}

// FileLib.exists resolves relative to the CT modules dir, so it can't check
// absolute paths; go through java.nio instead.
export function pathExists(path: string): boolean {
    try {
        return nioFiles().exists(nioPath(path));
    } catch (_e) {
        return false;
    }
}

export function isDirectory(path: string): boolean {
    try {
        return nioFiles().isDirectory(nioPath(path));
    } catch (_e) {
        return false;
    }
}

/** Recursively delete a directory (or file). Returns false when the path
 * doesn't exist or any delete failed. */
export function deleteDirRecursive(path: string): boolean {
    try {
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        const root = Paths.get(runtimeString(path));
        if (!Files.exists(root)) return false;
        deleteRecursive(Files, root);
        return !Files.exists(root);
    } catch (_e) {
        return false;
    }
}

function deleteRecursive(Files: HtswJavaFilesClass, p: HtswJavaPath): void {
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
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        return countRecursive(Files, Paths.get(runtimeString(path)));
    } catch (_e) {
        return 0;
    }
}

function countRecursive(Files: HtswJavaFilesClass, p: HtswJavaPath): number {
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
