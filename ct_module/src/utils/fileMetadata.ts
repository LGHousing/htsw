import { javaType } from "./java";

// Cache the type lookups: getMtimeMs is called in tight loops (mtime
// watcher, parse-cache fingerprint check) over hundreds of files, and
// `Java.type` is not free.
let _Paths: HtswJavaPathsClass | null = null;
let _Files: HtswJavaFilesClass | null = null;

export function getMtimeMs(path: string): number {
    try {
        if (_Paths === null) _Paths = javaType("java.nio.file.Paths");
        if (_Files === null) _Files = javaType("java.nio.file.Files");
        const millis: unknown = _Files.getLastModifiedTime(_Paths.get(path)).toMillis();
        return Number(millis);
    } catch (_e) {
        return 0;
    }
}

// FileLib.exists resolves relative to the CT modules dir, so it can't check the
// absolute import.json paths stored in recents — go through java.nio instead.
export function pathExists(path: string): boolean {
    try {
        if (_Paths === null) _Paths = javaType("java.nio.file.Paths");
        if (_Files === null) _Files = javaType("java.nio.file.Files");
        return _Files.exists(_Paths.get(path));
    } catch (_e) {
        return false;
    }
}
