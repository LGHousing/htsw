import { FileLoader } from "htsw";

export function removedFormatting(str: string): string {
    return str.replace(/(?:§|&)[0-9a-fklmnor]/g, "");
}

export function setAnvilItemName(newName: string) {
    const inventory = Player.getContainer();
    if (inventory == null) {
        throw new Error("No open container found");
    }
    const outputSlotField = inventory.container.class.getDeclaredField("field_82852_f");
    // @ts-ignore
    outputSlotField.setAccessible(true);
    const outputSlot = outputSlotField.get(inventory.container);

    const outputSlotItemField = outputSlot.class.getDeclaredField("field_70467_a");
    outputSlotItemField.setAccessible(true);
    let outputSlotItem = outputSlotItemField.get(outputSlot);

    outputSlotItem[0] = new Item(339).setName(newName).itemStack;
    outputSlotItemField.set(outputSlot, outputSlotItem);
}

export function acceptNewAnvilItem(): void {
    const inventory = Player.getContainer();
    if (inventory == null) {
        throw new Error("No open container found");
    }
    inventory.click(2, false);
}

export function chatWidth(string: string): number {
    const raw = ChatLib.removeFormatting(ChatLib.replaceFormatting(string));
    return Client.getMinecraft().field_71466_p.func_78256_a(raw);
}

export function spaceWidth() {
    return chatWidth(" ");
}

export function chatSeparator(): string {
    const totalWidth = ChatLib.getChatWidth();
    const sepWidth = chatWidth("-");

    return "-".repeat(totalWidth / sepWidth);
}

export class FileSystemFileLoader implements FileLoader {
    private rootPath(): any {
        return Java.type("java.nio.file.Paths")
            .get("./config/ChatTriggers/modules/HTSW")
            .toAbsolutePath()
            .normalize();
    }

    private normalizePath(path: string): string {
        const Paths = Java.type("java.nio.file.Paths");
        const p = Paths.get(path);
        if (p.isAbsolute()) return p.normalize().toString();
        return this.rootPath().resolve(p).normalize().toString();
    }

    fileExists(path: string): boolean {
        return FileLib.exists(this.normalizePath(path));
    }

    readFile(path: string): string {
        const content = FileLib.read(this.normalizePath(path));
        if (content === null) {
            throw new Error(`File at path ${path} does not exist`);
        }
        return content;
    }

    getParentPath(base: string): string {
        const Paths = Java.type("java.nio.file.Paths");
        const basePath = Paths.get(base);
        const normalized = basePath.isAbsolute()
            ? basePath.normalize()
            : this.rootPath().resolve(basePath).normalize();

        return normalized.getParent().toAbsolutePath().toString();
    }

    resolvePath(base: string, other: string): string {
        const Paths = Java.type("java.nio.file.Paths");
        const basePath = Paths.get(base);
        const otherPath = Paths.get(other);
        const normalizedBase = basePath.isAbsolute()
            ? basePath.normalize()
            : this.rootPath().resolve(basePath).normalize();

        return normalizedBase.resolve(otherPath).normalize().toAbsolutePath().toString();
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
