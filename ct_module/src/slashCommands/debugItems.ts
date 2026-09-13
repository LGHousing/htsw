import { isInCreativeMode } from "../housingSync/sideEffects";
import { snbtFromItem } from "../housingSync/items/itemNbt";
import {
    heldItem,
    inventorySlotToPacketSlot,
} from "../housingSync/items/playerInventory";
import {
    canonicalSlug,
    PROJECTS_ROOT,
    resolveModuleRelativePath,
} from "../project/paths";
import { getItemFromSnbt } from "../utils/nbt";
import { C10PacketCreativeInventoryAction } from "../utils/packets";
import { parseCommandArgs, quoteCommandArg } from "../utils/commandArgs";
import { atomicWriteText } from "../utils/filesystem";
import {
    chatSeparator,
    normalizeFormattingCodes,
    removedFormatting,
} from "../utils/helpers";
import { javaType, sendPacket } from "../utils/java";
import { setClipboardString } from "../utils/osShell";
import { chatLine, colouredComponent, rawComponent } from "../utils/chat";
import { basename, dirname } from "../gui/lib/pathDisplay";

function chatPath(path: string): string {
    const norm = path.split("\\").join("/");
    const dir = dirname(norm);
    return dir.length === 0 ? `&f${norm}` : `&7${dir}/&f${basename(norm)}`;
}

const ACTION_COLOUR = {
    view: "&b",
    copy: "&a",
    open: "&e",
    give: "&d",
    save: "&d",
} as const;

type ActionKind = keyof typeof ACTION_COLOUR;

function actionLink(kind: ActionKind, label: string, command: string): TextComponent {
    const suggests = kind === "give" || kind === "save";
    return colouredComponent(`${ACTION_COLOUR[kind]}[${label}]`)
        .setClick(suggests ? "suggest_command" : "run_command", command)
        .setHover(
            "show_text",
            suggests ? `&7Puts &f${command}&7 in your chat box` : `&7Runs &f${command}`
        );
}

function openAction(path: string): TextComponent {
    return actionLink("open", "open", `/htsw open ${pathAsCommandArg(path)}`);
}

function viewAction(path: string): TextComponent {
    return actionLink("view", "view", `/htsw viewitem ${pathAsCommandArg(path)}`);
}

function giveAction(path: string): TextComponent {
    return actionLink("give", "give", `/htsw giveitem ${pathAsCommandArg(path)}`);
}

function chatWithActions(text: string, actions: TextComponent[]): void {
    const parts: (string | TextComponent)[] = [text];
    for (let i = 0; i < actions.length; i++) parts.push(" ", actions[i]);
    chatLine(...parts);
}

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
        try {
            stream.close();
        } catch (_e) {}
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

function readItemSnbtFile(path: string): string | null {
    let snbt: string;
    try {
        const stored = FileLib.read(path) as unknown as string | null;
        snbt = stored ?? "";
    } catch (err) {
        chatLine(`&c[htsw] Could not read ${path}: ${String(err)}`);
        return null;
    }
    if (snbt.trim() === "") {
        chatLine(`&c[htsw] File is empty: ${path}`);
        return null;
    }
    return snbt;
}

function giveItemFromFile(path: string, slot: number): boolean {
    const snbt = readItemSnbtFile(path);
    if (snbt === null) return false;

    try {
        const item = getItemFromSnbt(snbt);
        sendPacket(
            new C10PacketCreativeInventoryAction(
                inventorySlotToPacketSlot(slot),
                item.getItemStack()
            )
        );
        chatWithActions(`&a[htsw] Gave item from ${chatPath(path)}`, [
            openAction(path),
            viewAction(path),
        ]);
        return true;
    } catch (err) {
        chatLine(`&c[htsw] Could not give item from ${path}: ${String(err)}`);
        return false;
    }
}

function resolveItemPath(rawPath: string): string {
    return resolveModuleRelativePath(rawPath).split("\\").join("/");
}

function resolveItemFilePath(rawPath: string): string {
    const path = resolveItemPath(rawPath);
    return path.toLowerCase().endsWith(".snbt") ? path : `${path}.snbt`;
}

function pathAsCommandArg(path: string): string {
    const root = `${PROJECTS_ROOT.split("\\").join("/")}/`;
    const relative = path.indexOf(root) === 0 ? path.substring(root.length) : path;
    return quoteCommandArg(relative);
}

function parseGiveItemFolderArgs(
    args: string[]
): { rawPath: string; skip: number; hasSkip: boolean } | null {
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
        chatLine("&c[htsw] No empty inventory slot.");
        return;
    }
    giveItemFromFile(filePath, slots[0]);
}

function giveFolderItems(rawPath: string, skip: number): void {
    if (rawPath.length === 0) {
        chatLine("&c[htsw] giveitem folder path cannot be empty.");
        return;
    }

    const dirPath = resolveItemPath(rawPath);
    let files: string[];
    try {
        files = listSnbtFiles(dirPath);
    } catch (err) {
        chatLine(`&c[htsw] Could not list folder ${dirPath}: ${String(err)}`);
        return;
    }
    if (files.length === 0) {
        chatLine(`&c[htsw] No .snbt files found in ${dirPath}`);
        return;
    }
    if (skip >= files.length) {
        chatLine(
            `&c[htsw] Skip ${skip} is past the ${files.length} item${files.length === 1 ? "" : "s"} in ${dirPath}.`
        );
        return;
    }

    const slots = emptyInventorySlots();
    if (slots.length === 0) {
        chatLine("&c[htsw] No empty inventory slot.");
        return;
    }
    const remaining = files.length - skip;
    if (slots.length < remaining) {
        chatLine(
            `&e[htsw] Only ${slots.length} empty slot${slots.length === 1 ? "" : "s"}, giving ${slots.length} of ${remaining} remaining items.`
        );
    }

    const count = Math.min(slots.length, remaining);
    let gave = 0;
    for (let i = 0; i < count; i++) {
        if (giveItemFromFile(files[skip + i], slots[i])) gave++;
    }
    chatWithActions(
        `&7[htsw] Gave ${gave}/${files.length} item${files.length === 1 ? "" : "s"} from ${chatPath(dirPath)}`,
        [openAction(dirPath)]
    );
    const nextSkip = skip + count;
    if (nextSkip < files.length) {
        chatLine(`&7  Next: &f/htsw giveitem ${quoteCommandArg(rawPath)} ${nextSkip}`);
    }
}

function saveItemTargetPath(rawPath: string, item: Item): string {
    const last = rawPath.charAt(rawPath.length - 1);
    const folderTarget =
        last === "/" || last === "\\" || isDirectory(resolveItemPath(rawPath));
    if (!folderTarget) return resolveItemFilePath(rawPath);

    const dirPath = resolveItemPath(rawPath).replace(/\/+$/, "");
    const name = removedFormatting(item.getName()).trim();
    return `${dirPath}/${canonicalSlug(name === "" ? "item" : name)}.snbt`;
}

export function saveItem(args: string[]): void {
    if (args.length === 0) {
        chatLine("&cUsage: /htsw saveitem <path>");
        chatLine("&7  Writes the item you're holding to a .snbt file, or into a folder.");
        return;
    }

    const parsed = parseCommandArgs(args);
    if (!parsed.ok) {
        chatLine(`&c[htsw] ${parsed.error}`);
        return;
    }
    if (parsed.args.length !== 1) {
        chatLine("&cUsage: /htsw saveitem <path>");
        chatLine("&7  Quote paths that contain spaces.");
        return;
    }

    const rawPath = parsed.args[0].trim();
    if (rawPath.length === 0) {
        chatLine("&c[htsw] saveitem path cannot be empty.");
        return;
    }

    const item = heldItem();
    if (item === null) {
        chatLine("&c[htsw] Hold the item you want to save.");
        return;
    }

    let snbt: string;
    let target: string;
    try {
        target = saveItemTargetPath(rawPath, item);
        snbt = snbtFromItem(item, { pretty: true });
    } catch (err) {
        chatLine(`&c[htsw] Could not read the held item: ${String(err)}`);
        return;
    }

    if (!atomicWriteText(target, snbt)) {
        chatLine(`&c[htsw] Could not write ${target}`);
        return;
    }

    chatWithActions(`&a[htsw] Saved held item to ${chatPath(target)}`, [
        openAction(target),
        viewAction(target),
        giveAction(target),
    ]);
}

export function clearInv(_args: string[]): void {
    if (!isInCreativeMode()) {
        chatLine("&c[htsw] Must be in creative mode to clear inventory.");
        return;
    }
    let cleared = 0;
    for (let slot = 9; slot < 36; slot++) {
        if (Player.getInventory()?.getStackInSlot(slot) === null) continue;
        sendPacket(
            new C10PacketCreativeInventoryAction(inventorySlotToPacketSlot(slot), null)
        );
        cleared++;
    }
    chatLine(
        `&7[htsw] Cleared ${cleared} main-inventory slot${cleared === 1 ? "" : "s"} (hotbar untouched).`
    );
}

export function giveItem(args: string[]): void {
    if (args.length === 0) {
        chatLine("&cUsage: /htsw giveitem <path> [skip]");
        chatLine("&7  Spawns an item from a .snbt file, or all .snbt files in a folder.");
        return;
    }

    if (!isInCreativeMode()) {
        chatLine("&c[htsw] Must be in creative mode to give an item.");
        return;
    }

    const parsed = parseCommandArgs(args);
    if (!parsed.ok) {
        chatLine(`&c[htsw] ${parsed.error}`);
        return;
    }

    const folderArgs = parseGiveItemFolderArgs(parsed.args);
    if (folderArgs === null) {
        chatLine("&cUsage: /htsw giveitem <path> [skip]");
        chatLine("&7  Quote paths that contain spaces.");
        return;
    }

    const rawPath = folderArgs.rawPath;
    if (rawPath.length === 0) {
        chatLine("&c[htsw] giveitem path cannot be empty.");
        return;
    }

    const filePath = resolveItemFilePath(rawPath);
    if (isRegularFile(filePath)) {
        if (folderArgs.hasSkip) {
            chatLine("&c[htsw] Skip is only supported for folders, not item files.");
            return;
        }
        giveSingleItemPath(filePath);
        return;
    }

    const literalDirPath = resolveItemPath(rawPath);
    if (isDirectory(literalDirPath)) {
        giveFolderItems(rawPath, folderArgs.skip);
        return;
    }

    const parsedDirPath = resolveItemPath(folderArgs.rawPath);
    if (!isDirectory(parsedDirPath)) {
        chatLine(`&c[htsw] File or folder not found: ${literalDirPath}`);
        chatLine(`&7  Tried file: ${filePath}`);
        return;
    }
    giveFolderItems(folderArgs.rawPath, folderArgs.skip);
}

const VIEW_ITEM_MAX_LINES = 90;

const HAND_SENTINEL = "@hand";

const VIEW_SNAPSHOT_LIMIT = 24;
const viewSnapshots: { id: number; snbt: string }[] = [];
let nextViewSnapshotId = 1;

function rememberViewSnapshot(snbt: string): number {
    const id = nextViewSnapshotId++;
    viewSnapshots.push({ id, snbt });
    while (viewSnapshots.length > VIEW_SNAPSHOT_LIMIT) viewSnapshots.shift();
    return id;
}

function viewSnapshot(id: number): string | null {
    for (let i = 0; i < viewSnapshots.length; i++) {
        if (viewSnapshots[i].id === id) return viewSnapshots[i].snbt;
    }
    return null;
}

function viewItemUsage(): void {
    chatLine(`&cUsage: /htsw viewitem [path|${HAND_SENTINEL}]`);
    chatLine("&7  Prints the held item's NBT, a .snbt file, or lists a folder of them.");
}

export function viewItem(args: string[]): void {
    if (args.length === 2 && args[0].toLowerCase() === "copy" && /^\d+$/.test(args[1])) {
        copyViewSnapshot(Number(args[1]));
        return;
    }

    const parsed = parseCommandArgs(args);
    if (!parsed.ok) {
        chatLine(`&c[htsw] ${parsed.error}`);
        return;
    }
    if (parsed.args.length > 1) {
        viewItemUsage();
        chatLine("&7  Quote paths that contain spaces.");
        return;
    }

    const rawPath = (parsed.args[0] ?? HAND_SENTINEL).trim();
    if (rawPath.length === 0 || rawPath.toLowerCase() === HAND_SENTINEL) {
        viewHeldItem();
        return;
    }

    const filePath = resolveItemFilePath(rawPath);
    if (isRegularFile(filePath)) {
        viewItemFile(filePath);
        return;
    }
    const dirPath = resolveItemPath(rawPath);
    if (isDirectory(dirPath)) {
        listItemFolder(dirPath);
        return;
    }
    chatLine(`&c[htsw] File or folder not found: ${dirPath}`);
    chatLine(`&7  Tried file: ${filePath}`);
}

function viewHeldItem(): void {
    const item = heldItem();
    if (item === null) {
        chatLine("&c[htsw] Hold the item you want to inspect.");
        return;
    }

    let snbt: string;
    try {
        snbt = snbtFromItem(item, { pretty: true });
    } catch (err) {
        chatLine(`&c[htsw] Could not read the held item: ${String(err)}`);
        return;
    }

    const name = removedFormatting(item.getName()).trim();
    printItemDump(`&f${name === "" ? "held item" : name}`, snbt, [
        actionLink("save", "save…", "/htsw saveitem "),
    ]);
}

function viewItemFile(filePath: string): void {
    const snbt = readItemSnbtFile(filePath);
    if (snbt === null) return;
    printItemDump(chatPath(filePath), snbt, [openAction(filePath), giveAction(filePath)]);
}

function printItemDump(title: string, snbt: string, actions: TextComponent[]): void {
    const id = rememberViewSnapshot(snbt);
    const lines = snbt.split("\r\n").join("\n").split("\n");
    const shown = Math.min(lines.length, VIEW_ITEM_MAX_LINES);

    chatLine(`&7${chatSeparator()}${invisibleNonce()}`);
    chatWithActions(
        `&e[htsw] ${title} &7· ${lines.length} line${lines.length === 1 ? "" : "s"}${invisibleNonce()}`,
        [actionLink("copy", "copy", `/htsw viewitem copy ${id}`), ...actions]
    );
    for (let i = 0; i < shown; i++) chatLiteral(lines[i]);
    if (shown < lines.length) {
        chatLine(
            `&7  … ${lines.length - shown} more ` +
                `line${lines.length - shown === 1 ? "" : "s"}; use &a[copy]&7 or ` +
                `&f/htsw saveitem <path>&7 for the rest.${invisibleNonce()}`
        );
    }
    chatLine(`&7${chatSeparator()}${invisibleNonce()}`);
}

function listItemFolder(dirPath: string): void {
    let files: string[];
    try {
        files = listSnbtFiles(dirPath);
    } catch (err) {
        chatLine(`&c[htsw] Could not list folder ${dirPath}: ${String(err)}`);
        return;
    }
    if (files.length === 0) {
        chatLine(`&c[htsw] No .snbt files found in ${dirPath}`);
        return;
    }

    chatWithActions(
        `&e[htsw] ${chatPath(dirPath)} &7· ${files.length} item${files.length === 1 ? "" : "s"}`,
        [openAction(dirPath)]
    );
    for (let i = 0; i < files.length; i++) {
        chatWithActions(`&7  &f${basename(files[i])}`, [
            viewAction(files[i]),
            giveAction(files[i]),
            openAction(files[i]),
        ]);
    }
}

function chatLiteral(text: string): void {
    chatLine(rawComponent(normalizeFormattingCodes(text) + invisibleNonce()));
}

let chatNonce = 0;

function invisibleNonce(): string {
    const digits = (chatNonce++).toString(16);
    let out = "";
    for (let i = 0; i < digits.length; i++) out += "§" + digits[i];
    return out;
}

function copyViewSnapshot(id: number): void {
    const snbt = viewSnapshot(id);
    if (snbt === null) {
        chatLine("&c[htsw] That dump is no longer held — run /htsw viewitem again.");
        return;
    }
    if (setClipboardString(snbt)) {
        chatLine("&a[htsw] Copied the item SNBT to your clipboard.");
    }
}
