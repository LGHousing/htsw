import type { ProjectFs } from "htsw-editor-common/project";

function rootPath(): any {
    return Java.type("java.nio.file.Paths")
        .get(String("."))
        .toAbsolutePath()
        .normalize();
}

function normalizePath(path: string): string {
    const Paths = Java.type("java.nio.file.Paths");
    const p = Paths.get(String(path));
    if (p.isAbsolute()) return String(p.normalize().toString());
    return String(rootPath().resolve(p).normalize().toString());
}

export const ctProjectFs: ProjectFs = {
    exists(path: string): boolean {
        const Files = Java.type("java.nio.file.Files");
        const Paths = Java.type("java.nio.file.Paths");
        return Files.exists(Paths.get(normalizePath(path)));
    },

    readFile(path: string): string {
        const normalized = normalizePath(path);
        const content = FileLib.read(normalized);
        if (content !== null) return String(content);

        const Files = Java.type("java.nio.file.Files");
        const Paths = Java.type("java.nio.file.Paths");
        const JString = Java.type("java.lang.String");
        const p = Paths.get(normalized);
        if (!Files.exists(p)) throw new Error(`File at path ${path} does not exist`);
        return String(new JString(Files.readAllBytes(p)));
    },

    writeFile(path: string, text: string): void {
        FileLib.write(normalizePath(path), text, true);
    },

    ensureDir(path: string): void {
        const Paths = Java.type("java.nio.file.Paths");
        const Files = Java.type("java.nio.file.Files");
        Files.createDirectories(Paths.get(normalizePath(path)));
    },

    parentDir(path: string): string {
        const Paths = Java.type("java.nio.file.Paths");
        const p = Paths.get(normalizePath(path)).getParent();
        return String(p.toAbsolutePath().normalize().toString());
    },

    resolvePath(baseDir: string, ref: string): string {
        const Paths = Java.type("java.nio.file.Paths");
        const base = Paths.get(normalizePath(baseDir));
        const other = Paths.get(String(ref));
        if (other.isAbsolute()) return String(other.normalize().toString());
        return String(base.resolve(other).normalize().toAbsolutePath().toString());
    },

    deleteFile(path: string): void {
        FileLib.delete(normalizePath(path));
    },
};
