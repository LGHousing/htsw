import { FileLoader } from "htsw";

export function removeFormatting(str: string): string {
    return str.replace(/(?:§|&)[0-9a-fklmnor]/g, "");
}

type ChatHistoryEntry = {
    message: string;
    timestamp: number;
};

const CHAT_HISTORY_MAX_AGE = 5 * 60 * 1000;
const CHAT_HISTORY: ChatHistoryEntry[] = [];

register("chat", (event: string | ForgeClientChatReceivedEvent) => {
    // @ts-ignore
    const message = ChatLib.getChatMessage(event, true);

    const entry: ChatHistoryEntry = {
        message: message,
        timestamp: Date.now(),
    };
    CHAT_HISTORY.push(entry);

    const now = Date.now();
    while (
        CHAT_HISTORY.length > 0 &&
        CHAT_HISTORY[0].timestamp < now - CHAT_HISTORY_MAX_AGE
    ) {
        CHAT_HISTORY.shift();
    }
});

export function chatHistory(since: number): ChatHistoryEntry[] {
    return CHAT_HISTORY.filter((entry) => entry.timestamp >= since);
}

export function chatHistoryContains(
    message: string,
    since: number,
    exact: boolean,
    formatted: boolean
): boolean {
    for (const entry of chatHistory(since)) {
        console.log(JSON.stringify(entry, null, 0));
        let entryMessage: string;
        if (formatted) {
            entryMessage = entry.message;
        } else {
            entryMessage = removeFormatting(entry.message);
        }

        let matches: boolean;
        if (exact) {
            matches = entryMessage === message;
        } else {
            matches = entryMessage.includes(message);
        }

        if (matches) {
            return true;
        }
    }
    return false;
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
        return FileLib.read(this.normalizePath(path));
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
