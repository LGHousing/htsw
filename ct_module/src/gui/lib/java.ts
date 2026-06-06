/// <reference types="../../../CTAutocomplete" />

declare const Java: {
    type(name: string): any;
};

export function javaType<T = any>(name: string): T {
    return Java.type(name) as T;
}

export const GL11: any = javaType("org.lwjgl.opengl.GL11");

// Cache the type lookups: getMtimeMs is called in tight loops (mtime
// watcher, parse-cache fingerprint check) over hundreds of files, and
// `Java.type` is not free.
let _Paths: any = null;
let _Files: any = null;

export function getMtimeMs(path: string): number {
    try {
        if (_Paths === null) _Paths = javaType("java.nio.file.Paths");
        if (_Files === null) _Files = javaType("java.nio.file.Files");
        return Number(_Files.getLastModifiedTime(_Paths.get(String(path))).toMillis());
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
        return _Files.exists(_Paths.get(String(path)));
    } catch (_e) {
        return false;
    }
}
