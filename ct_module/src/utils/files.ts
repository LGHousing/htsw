import { FileLoader } from "htsw";

export class FileSystemFileLoader implements FileLoader {
    private rootPath(): any {
        return Java.type("java.nio.file.Paths")
            .get(String("./config/ChatTriggers/modules/HTSW"))
            .toAbsolutePath()
            .normalize();
    }

    private normalizePath(path: string): string {
        const Paths = Java.type("java.nio.file.Paths");
        const p = Paths.get(String(path));
        if (p.isAbsolute()) return String(p.normalize().toString());
        return String(this.rootPath().resolve(p).normalize().toString());
    }

    fileExists(path: string): boolean {
        const Files = Java.type("java.nio.file.Files");
        const Paths = Java.type("java.nio.file.Paths");
        return Files.exists(Paths.get(this.normalizePath(path)));
    }

    readFile(path: string): string {
        const normalized = this.normalizePath(path);
        let content: string | null = FileLib.read(normalized);
        if (content === null) {
            const Files = Java.type("java.nio.file.Files");
            const Paths = Java.type("java.nio.file.Paths");
            const JString = Java.type("java.lang.String");
            const p = Paths.get(normalized);
            if (Files.exists(p)) {
                content = String(new JString(Files.readAllBytes(p)));
            }
        }
        if (content === null) {
            throw new Error(`File at path ${path} does not exist`);
        }
        return String(content);
    }

    getParentPath(base: string): string {
        const Paths = Java.type("java.nio.file.Paths");
        const basePath = Paths.get(String(base));
        const normalized = basePath.isAbsolute()
            ? basePath.normalize()
            : this.rootPath().resolve(basePath).normalize();

        return String(normalized.getParent().toAbsolutePath().toString());
    }

    resolvePath(base: string, other: string): string {
        const Paths = Java.type("java.nio.file.Paths");
        const basePath = Paths.get(String(base));
        const otherPath = Paths.get(String(other));
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
