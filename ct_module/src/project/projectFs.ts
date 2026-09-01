import type { ProjectFs } from "htsw-editor-common/project";
import { javaType, runtimeString, type RuntimeString } from "../utils/java";

function rootPath(): HtswJavaPath {
    return javaType("java.nio.file.Paths")
        .get(runtimeString("."))
        .toAbsolutePath()
        .normalize();
}

function normalizePath(path: string): string {
    const Paths = javaType("java.nio.file.Paths");
    const p = Paths.get(runtimeString(path));
    if (p.isAbsolute()) return String(p.normalize().toString());
    return String(rootPath().resolve(p).normalize().toString());
}

const CASE_INSENSITIVE_PATHS = String(
    javaType("java.lang.System").getProperty("os.name")
)
    .toLowerCase()
    .indexOf("win") >= 0;

export const ctProjectFs: ProjectFs = {
    exists(path: string): boolean {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        return Files.exists(Paths.get(normalizePath(path)));
    },

    readFile(path: string): string {
        const normalized = normalizePath(path);
        const content = FileLib.read(normalized) as RuntimeString | null;
        if (content !== null) return runtimeString(content);

        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        const JString = javaType("java.lang.String");
        const p = Paths.get(normalized);
        if (!Files.exists(p)) throw new Error(`File at path ${path} does not exist`);
        return String(new JString(Files.readAllBytes(p)));
    },

    writeFile(path: string, text: string): void {
        FileLib.write(normalizePath(path), text, true);
    },

    ensureDir(path: string): void {
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        Files.createDirectories(Paths.get(normalizePath(path)));
    },

    parentDir(path: string): string {
        const Paths = javaType("java.nio.file.Paths");
        const p = Paths.get(normalizePath(path)).getParent();
        if (p === null) return normalizePath(path);
        return String(p.toAbsolutePath().normalize().toString());
    },

    resolvePath(baseDir: string, ref: string): string {
        const Paths = javaType("java.nio.file.Paths");
        const base = Paths.get(normalizePath(baseDir));
        const other = Paths.get(runtimeString(ref));
        if (other.isAbsolute()) return String(other.normalize().toString());
        return String(base.resolve(other).normalize().toAbsolutePath().toString());
    },

    pathKey(path: string): string {
        const normalized = normalizePath(path).split("\\").join("/");
        return CASE_INSENSITIVE_PATHS ? normalized.toLowerCase() : normalized;
    },

    realPath(path: string): string {
        const Paths = javaType("java.nio.file.Paths");
        try {
            return String(Paths.get(normalizePath(path)).toRealPath().toString());
        } catch {
            return normalizePath(path);
        }
    },

    deleteFile(path: string): void {
        FileLib.delete(normalizePath(path));
    },
};
