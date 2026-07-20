import { FileLoader } from "htsw";
import { javaType, runtimeString, type RuntimeString } from "./java";

export class FileSystemFileLoader implements FileLoader {
    private rootPath(): HtswJavaPath {
        // Root at the JVM working directory — for CT modules running inside
        // Minecraft this is the `.minecraft` install root. Matches what
        // FileLib + the explore tab's NIO walk already do, so a path like
        // `./htsw/projects/foo/import.json` resolves the same way everywhere.
        return javaType("java.nio.file.Paths")
            .get(runtimeString("."))
            .toAbsolutePath()
            .normalize();
    }

    private normalizePath(path: string): string {
        const Paths = javaType("java.nio.file.Paths");
        const p = Paths.get(runtimeString(path));
        if (p.isAbsolute()) return String(p.normalize().toString());
        return String(this.rootPath().resolve(p).normalize().toString());
    }

    fileExists(path: string): boolean {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        return Files.exists(Paths.get(this.normalizePath(path)));
    }

    readFile(path: string): string {
        const normalized = this.normalizePath(path);
        let content = FileLib.read(normalized) as RuntimeString | null;
        if (content === null) {
            const Files = javaType("java.nio.file.Files");
            const Paths = javaType("java.nio.file.Paths");
            const JString = javaType("java.lang.String");
            const p = Paths.get(normalized);
            if (Files.exists(p)) {
                content = String(new JString(Files.readAllBytes(p)));
            }
        }
        if (content === null) {
            throw new Error(`File at path ${path} does not exist`);
        }
        return runtimeString(content);
    }

    getParentPath(base: string): string {
        const Paths = javaType("java.nio.file.Paths");
        const basePath = Paths.get(runtimeString(base));
        const normalized = basePath.isAbsolute()
            ? basePath.normalize()
            : this.rootPath().resolve(basePath).normalize();

        const parent = normalized.getParent();
        return String((parent === null ? normalized : parent).toAbsolutePath().toString());
    }

    resolvePath(base: string, other: string): string {
        const Paths = javaType("java.nio.file.Paths");
        const basePath = Paths.get(runtimeString(base));
        const otherPath = Paths.get(runtimeString(other));
        const normalizedBase = basePath.isAbsolute()
            ? basePath.normalize()
            : this.rootPath().resolve(basePath).normalize();

        return String(
            normalizedBase.resolve(otherPath).normalize().toAbsolutePath().toString()
        );
    }
}

export class StringFileLoader implements FileLoader {
    src: string;

    constructor(src: string) {
        this.src = src;
    }

    fileExists(_path: string): boolean {
        return true;
    }
    readFile(_path: string): string {
        return this.src;
    }
    getParentPath(_base: string): string {
        return "";
    }
    resolvePath(_base: string, _other: string): string {
        return "";
    }
}
