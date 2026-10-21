// The client the importer runs on. The importer never touches a game, a file
// system or a thread itself; it calls the client through two kinds of hook,
// both declared here in importer/ and implemented by the client:
//
// - platform(): the Platform below, for the calls that were ChatTriggers
//   globals inside the importer (ChatLib.chat, FileLib, Player, Server, Java
//   threads and files, the chat packet).
// - client modules: utils/filesystem.ts, tasks/specifics/slots.ts and the other
//   files that start with "Client module". Each declares the exports the
//   importer uses from one client file of the same name.
//
// This file is a client module too. A client supplies each one by resolving
// imports of it to its own implementation at build time: ct_module does it in
// scripts/importerClientModules.ts, for its bundle and its tests, and checks
// the signatures in src/importerClientConformance.ts. Nothing in a client
// module runs, so an importer bundled without its client fails to load.

/** A client item stack (`net.minecraft.item.ItemStack` on ChatTriggers). The
 * importer only passes it back to the client. */
export type MCItemStack = object;

/** A client packet. The importer only passes it back to the client. */
export type Packet = object;

/** A client item: what the importer reads off an item in a menu or inventory
 * (ChatTriggers' `Item`). */
export interface Item {
    getName(): string;
    getLore(): string[];
    getRawNBT(): string;
    getRegistryName(): string;
    getMetadata(): number;
    getItemStack(): MCItemStack;
}

/** An open container or the player's inventory (ChatTriggers' `Inventory`). */
export interface Container {
    getSize(): number;
    getStackInSlot(slot: number): Item | null;
    getName(): string;
    getClassName(): string;
    click(slot: number, shift?: boolean, button?: string): unknown;
}

/** Text file access (ChatTriggers' `FileLib`). Paths are relative to the
 * client's working directory. */
export interface FileLibHooks {
    exists(path: string): boolean;
    read(path: string): string;
    write(path: string, contents: string, createParents?: boolean): void;
    delete(path: string): boolean;
}

/** File-system operations beyond FileLibHooks, on the same relative paths. */
export interface FilesHooks {
    /** Names in `dir`, or null when it can't be listed. */
    listNames(dir: string): ArrayLike<unknown> | null;
    exists(path: string): boolean;
    notExists(path: string): boolean;
    move(from: string, to: string): void;
    deleteIfExists(path: string): void;
    /** Delete `path` and, for a directory, everything under it. */
    deleteRecursive(path: string): void;
    /** Call `visit` with each file name in `dir`; nothing when `dir` is missing
     * or not a directory. */
    forEachFileName(dir: string, visit: (name: string) => void): void;
}

export interface Platform {
    /** Show a line in the player's chat; `&` colour codes allowed. */
    chat(message: string): void;
    /** How wide `text` renders in chat, in pixels. */
    chatWidth(text: string, hasFormatCodes: boolean): number;
    /** Width of the chat box, in pixels. */
    chatBoxWidth(): number;
    /** The player's name. */
    playerName(): string;
    /** The connected server's address. */
    serverIp(): string;
    /** The open container (`Player.getContainer()`), undefined with none open. */
    openContainer(): Container | undefined;
    /** The player's own inventory (`Player.getInventory()`), null with no player. */
    playerInventory(): Container | null;
    /** Call `callback` once, `delay` ms from now (ChatTriggers' `setTimeout`,
     * which runs it on a new thread). */
    setTimeout(callback: () => void, delay: number): void;
    /** Run `run` on a new background (daemon) thread. */
    startDaemonThread(run: () => void): void;
    /** True on the client's main (game) thread. */
    isMainThread(): boolean;
    /** A chat packet carrying `message` whole (up to the server's 256
     * characters), past the client's own 100-character cap. */
    createChatPacket(message: string): Packet;
    sendPacket(packet: Packet): void;
    /** Call `handler` with each chat line the player sends; `cancelSend` stops
     * that line from going out. */
    onMessageSent(handler: (message: string, cancelSend: () => void) => void): void;
    fileLib: FileLibHooks;
    files: FilesHooks;
}

export declare function platform(): Platform;
