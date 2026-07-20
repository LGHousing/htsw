import { isInCreativeMode } from "../housingSync/sideEffects";
import { resolveModuleRelativePath } from "../project/paths";
import { getItemFromSnbt } from "../utils/nbt";
import { C10PacketCreativeInventoryAction } from "../utils/packets";
import { parseCommandArgs, quoteCommandArg } from "../utils/commandArgs";
import { javaType, sendPacket } from "../utils/java";

function javaPath(path: string): HtswJavaPath {
    return javaType("java.nio.file.Paths").get(path);
}

function isRegularFile(path: string): boolean {
    try {
        const Files = javaType("java.nio.file.Files");
        return Files.isRegularFile(javaPath(path));
    } catch (_e) {
        return false;
    }
}

function isDirectory(path: string): boolean {
    try {
        const Files = javaType("java.nio.file.Files");
        return Files.isDirectory(javaPath(path));
    } catch (_e) {
        return false;
    }
}

function listSnbtFiles(path: string): string[] {
    const out: string[] = [];
    const Files = javaType("java.nio.file.Files");
    const stream = Files.newDirectoryStream(javaPath(path));
    try {
        const it = stream.iterator();
        while (it.hasNext()) {
            const child = it.next();
            const childPath = String(child.toString()).split("\\").join("/");
            if (Files.isRegularFile(child) && childPath.toLowerCase().endsWith(".snbt")) {
                out.push(childPath);
            }
        }
    } finally {
        try { stream.close(); } catch (_e) {}
    }
    out.sort();
    return out;
}

function emptyInventorySlots(): number[] {
    const inv = Player.getInventory();
    if (inv === null) return [];
    const slots: number[] = [];
    for (let i = 0; i < 36; i++) {
        if (inv.getStackInSlot(i) === null) slots.push(i);
    }
    return slots;
}

function packetSlotForInventorySlot(slot: number): number {
    return slot < 9 ? slot + 36 : slot;
}

function giveItemFromFile(path: string, slot: number): boolean {
    let snbt: string;
    try {
        const stored = FileLib.read(path) as unknown as string | null;
        snbt = stored ?? "";
    } catch (err) {
        ChatLib.chat(`&c[htsw] Could not read ${path}: ${String(err)}`);
        return false;
    }
    if (snbt.trim() === "") {
        ChatLib.chat(`&c[htsw] File is empty: ${path}`);
        return false;
    }

    try {
        const item = getItemFromSnbt(snbt);
        sendPacket(
            new C10PacketCreativeInventoryAction(
                packetSlotForInventorySlot(slot),
                item.getItemStack()
            )
        );
        ChatLib.chat(`&a[htsw] Gave item from ${path}`);
        return true;
    } catch (err) {
        ChatLib.chat(`&c[htsw] Could not give item from ${path}: ${String(err)}`);
        return false;
    }
}

function resolveGiveItemFilePath(rawPath: string): string {
    let path = resolveModuleRelativePath(rawPath).split("\\").join("/");
    if (!path.toLowerCase().endsWith(".snbt")) path += ".snbt";
    return path;
}

function parseGiveItemFolderArgs(args: string[]): { rawPath: string; skip: number; hasSkip: boolean } | null {
    if (args.length === 1) return { rawPath: args[0].trim(), skip: 0, hasSkip: false };
    if (args.length === 2 && /^\d+$/.test(args[1])) {
        return {
            rawPath: args[0].trim(),
            skip: Number(args[1]),
            hasSkip: true,
        };
    }
    return null;
}

function giveSingleItemPath(filePath: string): void {
    const slots = emptyInventorySlots();
    if (slots.length === 0) {
        ChatLib.chat("&c[htsw] No empty inventory slot.");
        return;
    }
    giveItemFromFile(filePath, slots[0]);
}

function giveFolderItems(rawPath: string, skip: number): void {
    if (rawPath.length === 0) {
        ChatLib.chat("&c[htsw] giveitem folder path cannot be empty.");
        return;
    }

    const dirPath = resolveModuleRelativePath(rawPath).split("\\").join("/");
    let files: string[];
    try {
        files = listSnbtFiles(dirPath);
    } catch (err) {
        ChatLib.chat(`&c[htsw] Could not list folder ${dirPath}: ${String(err)}`);
        return;
    }
    if (files.length === 0) {
        ChatLib.chat(`&c[htsw] No .snbt files found in ${dirPath}`);
        return;
    }
    if (skip >= files.length) {
        ChatLib.chat(`&c[htsw] Skip ${skip} is past the ${files.length} item${files.length === 1 ? "" : "s"} in ${dirPath}.`);
        return;
    }

    const slots = emptyInventorySlots();
    if (slots.length === 0) {
        ChatLib.chat("&c[htsw] No empty inventory slot.");
        return;
    }
    const remaining = files.length - skip;
    if (slots.length < remaining) {
        ChatLib.chat(`&e[htsw] Only ${slots.length} empty slot${slots.length === 1 ? "" : "s"}, giving ${slots.length} of ${remaining} remaining items.`);
    }

    const count = Math.min(slots.length, remaining);
    let gave = 0;
    for (let i = 0; i < count; i++) {
        if (giveItemFromFile(files[skip + i], slots[i])) gave++;
    }
    ChatLib.chat(`&7[htsw] Gave ${gave}/${files.length} item${files.length === 1 ? "" : "s"} from ${dirPath}`);
    const nextSkip = skip + count;
    if (nextSkip < files.length) {
        ChatLib.chat(`&7  Next: &f/htsw giveitem ${quoteCommandArg(rawPath)} ${nextSkip}`);
    }
}

export function clearInv(_args: string[]): void {
    if (!isInCreativeMode()) {
        ChatLib.chat("&c[htsw] Must be in creative mode to clear inventory.");
        return;
    }
    let cleared = 0;
    for (let slot = 9; slot < 36; slot++) {
        if (Player.getInventory()?.getStackInSlot(slot) === null) continue;
        sendPacket(
            new C10PacketCreativeInventoryAction(packetSlotForInventorySlot(slot), null)
        );
        cleared++;
    }
    ChatLib.chat(`&7[htsw] Cleared ${cleared} main-inventory slot${cleared === 1 ? "" : "s"} (hotbar untouched).`);
}

export function giveItem(args: string[]): void {
    if (args.length === 0) {
        ChatLib.chat("&cUsage: /htsw giveitem <path> [skip]");
        ChatLib.chat("&7  Spawns an item from a .snbt file, or all .snbt files in a folder.");
        return;
    }

    if (!isInCreativeMode()) {
        ChatLib.chat("&c[htsw] Must be in creative mode to give an item.");
        return;
    }

    const parsed = parseCommandArgs(args);
    if (!parsed.ok) {
        ChatLib.chat(`&c[htsw] ${parsed.error}`);
        return;
    }

    const folderArgs = parseGiveItemFolderArgs(parsed.args);
    if (folderArgs === null) {
        ChatLib.chat("&cUsage: /htsw giveitem <path> [skip]");
        ChatLib.chat("&7  Quote paths that contain spaces.");
        return;
    }

    const rawPath = folderArgs.rawPath;
    if (rawPath.length === 0) {
        ChatLib.chat("&c[htsw] giveitem path cannot be empty.");
        return;
    }

    const filePath = resolveGiveItemFilePath(rawPath);
    if (isRegularFile(filePath)) {
        if (folderArgs.hasSkip) {
            ChatLib.chat("&c[htsw] Skip is only supported for folders, not item files.");
            return;
        }
        giveSingleItemPath(filePath);
        return;
    }

    const literalDirPath = resolveModuleRelativePath(rawPath).split("\\").join("/");
    if (isDirectory(literalDirPath)) {
        giveFolderItems(rawPath, folderArgs.skip);
        return;
    }

    const parsedDirPath = resolveModuleRelativePath(folderArgs.rawPath).split("\\").join("/");
    if (!isDirectory(parsedDirPath)) {
        ChatLib.chat(`&c[htsw] File or folder not found: ${literalDirPath}`);
        ChatLib.chat(`&7  Tried file: ${filePath}`);
        return;
    }
    giveFolderItems(folderArgs.rawPath, folderArgs.skip);
}
