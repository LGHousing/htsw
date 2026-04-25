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
        // CT's FileLib.exists is unreliable for absolute paths (it interprets
        // its input relative to the modules folder and silently returns false
        // for paths it can't reconcile). Java NIO handles both absolute and
        // relative inputs cleanly because we've already normalized them.
        const Files = Java.type("java.nio.file.Files");
        const Paths = Java.type("java.nio.file.Paths");
        return Files.exists(Paths.get(this.normalizePath(path)));
    }

    readFile(path: string): string {
        // FileLib.read has the same absolute-path issue as FileLib.exists,
        // so fall back to Java NIO when FileLib returns null on a path we
        // know is absolute and normalized.
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
