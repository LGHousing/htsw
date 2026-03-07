const Paths = Java.type("java.nio.file.Paths");

export function resolveModulePath(path: string): string {
    const pathObj = Paths.get(path);
    if (pathObj.isAbsolute()) {
        return pathObj.normalize().toString();
    }

    const moduleRoot = Paths.get("./config/ChatTriggers/modules/HTSW")
        .toAbsolutePath()
        .normalize();

    return moduleRoot.resolve(pathObj).normalize().toString();
}

export function parentPath(path: string): string {
    const normalized = Paths.get(resolveModulePath(path)).normalize();
    const parent = normalized.getParent();
    return parent == null ? normalized.toString() : parent.toString();
}

export function joinPath(base: string, other: string): string {
    return Paths.get(base).resolve(other).normalize().toString();
}

export function relativePath(fromDir: string, toPath: string): string {
    return Paths.get(fromDir).normalize().relativize(Paths.get(toPath).normalize())
        .toString()
        .replace(/\\/g, "/");
}

export function fileExists(path: string): boolean {
    return FileLib.exists(resolveModulePath(path));
}

export function readText(path: string): string {
    return FileLib.read(resolveModulePath(path));
}

export function writeText(path: string, text: string, recursive: boolean = true): void {
    FileLib.write(resolveModulePath(path), text, recursive);
}

