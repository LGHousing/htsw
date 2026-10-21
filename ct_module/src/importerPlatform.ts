/// <reference types="../CTAutocomplete" />

// The ChatTriggers Platform behind importer/src/platform.ts: importer imports
// of "platform" resolve here (scripts/importerClientModules.ts).
import type { Platform } from "@htsw/importer";

import { getMinecraft, javaType, sendPacket } from "./utils/java";

function deletePathRecursive(Files: HtswJavaFilesClass, path: HtswJavaPath): void {
    if (Files.isDirectory(path)) {
        const stream = Files.newDirectoryStream(path);
        try {
            const it = stream.iterator();
            while (it.hasNext()) {
                deletePathRecursive(Files, it.next());
            }
        } finally {
            try {
                stream.close();
            } catch (_e) {
                /* ignore */
            }
        }
    }
    Files.deleteIfExists(path);
}

let chatPacketClass:
    HtswJavaTypeMap["net.minecraft.network.play.client.C01PacketChatMessage"] | null =
    null;

const ctPlatform: Platform = {
    chat(message) {
        ChatLib.chat(message);
    },
    chatWidth(text, hasFormatCodes) {
        const raw = hasFormatCodes ? ChatLib.addColor(text) : text;
        return getMinecraft().field_71466_p.func_78256_a(raw);
    },
    chatBoxWidth: () => ChatLib.getChatWidth(),
    playerName: () => Player.getName(),
    serverIp: () => Server.getIP(),
    openContainer: () => Player.getContainer(),
    playerInventory: () => Player.getInventory(),
    setTimeout(callback, delay) {
        setTimeout(callback, delay);
    },
    startDaemonThread(run) {
        const Thread = javaType("java.lang.Thread");
        const Runnable = javaType("java.lang.Runnable");
        const thread = new Thread(new Runnable({ run }));
        thread.setDaemon(true);
        thread.start();
    },
    isMainThread: () => getMinecraft().func_152345_ab(),
    createChatPacket(message) {
        // Looked up on first use, not at load: this module loads with
        // utils/helpers.ts, long before the first chat packet.
        if (chatPacketClass === null) {
            chatPacketClass = javaType(
                "net.minecraft.network.play.client.C01PacketChatMessage"
            );
        }
        const packet = new chatPacketClass("");
        const messageField = packet.class.getDeclaredField("field_149440_a");
        messageField.setAccessible(true);
        messageField.set(packet, message);
        return packet;
    },
    sendPacket(packet) {
        sendPacket(packet as HtswPacketInstance);
    },
    onMessageSent(handler) {
        register("messageSent", (message, event) => {
            handler(message, () => cancel(event));
        });
    },
    fileLib: {
        exists: (path) => FileLib.exists(path),
        read: (path) => FileLib.read(path),
        // Keep the call's arity: FileLib.write(a, b, c) with three strings is the
        // (module, file, contents) overload.
        write(path, contents, createParents) {
            if (createParents === undefined) FileLib.write(path, contents);
            else FileLib.write(path, contents, createParents);
        },
        delete: (path) => FileLib.delete(path),
    },
    files: {
        listNames(dir) {
            const File = javaType("java.io.File");
            return new File(dir).list();
        },
        exists: (path) =>
            javaType("java.nio.file.Files").exists(
                javaType("java.nio.file.Paths").get(path)
            ),
        notExists: (path) =>
            javaType("java.nio.file.Files").notExists(
                javaType("java.nio.file.Paths").get(path)
            ),
        move(from, to) {
            const Paths = javaType("java.nio.file.Paths");
            javaType("java.nio.file.Files").move(Paths.get(from), Paths.get(to));
        },
        deleteIfExists(path) {
            javaType("java.nio.file.Files").deleteIfExists(
                javaType("java.nio.file.Paths").get(path)
            );
        },
        deleteRecursive(path) {
            deletePathRecursive(
                javaType("java.nio.file.Files"),
                javaType("java.nio.file.Paths").get(path)
            );
        },
        forEachFileName(dir, visit) {
            const Paths = javaType("java.nio.file.Paths");
            const Files = javaType("java.nio.file.Files");
            const path = Paths.get(dir);
            if (!Files.exists(path) || !Files.isDirectory(path)) return;
            const stream = Files.newDirectoryStream(path);
            try {
                const it = stream.iterator();
                while (it.hasNext()) {
                    const listedName = it.next().getFileName();
                    if (listedName === null) continue;
                    visit(String(listedName.toString()));
                }
            } finally {
                try {
                    stream.close();
                } catch (_e) {
                    /* ignore */
                }
            }
        },
    },
};

export function platform(): Platform {
    return ctPlatform;
}
