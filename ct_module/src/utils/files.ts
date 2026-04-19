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
        return FileLib.exists(this.normalizePath(path));
    }

    readFile(path: string): string {
        const content = FileLib.read(this.normalizePath(path));
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

        return String(normalizedBase.resolve(otherPath).normalize().toAbsolutePath().toString());
    }
}

export class StringFileLoader implements FileLoader {
    src: string;

    constructor(src: string) {
        this.src = src;
    }

    fileExists(path: string): boolean {
        return true;
    }
    readFile(path: string): string {
        return this.src;
    }
    getParentPath(base: string): string {
        return "";
    }
    resolvePath(base: string, other: string): string {
        return "";
    }
}
