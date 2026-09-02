export interface ProjectFs {
    exists(path: string): boolean;
    readFile(path: string): string;
    writeFile(path: string, text: string): void;
    ensureDir(path: string): void;
    parentDir(path: string): string;
    resolvePath(baseDir: string, ref: string): string;
    /** Identity key using this filesystem's path and case-sensitivity rules. */
    pathKey(path: string): string;
    /** Canonical path with symlinks resolved. Absent when the filesystem cannot resolve them. */
    realPath?(path: string): string;
    deleteFile?(path: string): void;
}

export function joinPath(left: string, right: string): string {
    if (left.length === 0) return right;
    if (left.charAt(left.length - 1) === "/" || left.charAt(left.length - 1) === "\\") {
        return left + right;
    }
    return left + "/" + right;
}

export function parentDir(path: string): string {
    const normalized = normalizePathSeparators(path);
    const slash = normalized.lastIndexOf("/");
    if (slash < 0) return ".";
    if (slash === 0) return "/";
    return normalized.substring(0, slash);
}

export function normalizePathSeparators(path: string): string {
    return path.split("\\").join("/");
}

export function normalizeRelativeProjectPath(path: string): string {
    const normalized = normalizePathSeparators(path.trim());
    if (normalized === "") throw new Error("Enter a folder path.");
    if (normalized.charAt(0) === "/" || /^[A-Za-z]:\//.test(normalized)) {
        throw new Error("Choose a relative folder path.");
    }

    const parts = normalized.split("/");
    const out: string[] = [];
    for (const part of parts) {
        if (part === "" || part === ".") continue;
        if (part === "..") throw new Error("Folder path cannot contain '..'.");
        out.push(part);
    }
    if (out.length === 0) throw new Error("Choose a new folder inside the selected folder.");
    return out.join("/");
}

export function isSafeProjectName(name: string): boolean {
    const trimmed = name.trim();
    return trimmed.length > 0 &&
        trimmed.indexOf("/") < 0 &&
        trimmed.indexOf("\\") < 0 &&
        trimmed.indexOf("..") < 0;
}
