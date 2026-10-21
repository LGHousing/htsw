/// <reference types="../../CTAutocomplete" />

import { getHousingUuid } from "@htsw/importer/runtime/state/index";
import { deleteImportableCache, writePresence } from "@htsw/importer/importCache/cache";

// Liveness: Hypixel announces function and region create/delete/rename, and
// menu creation, in chat. Only the house we're standing in can change, so
// every mutation targets the current UUID.
export function initChatLiveness(): void {
    // Read the event through a declared parameter only: on this Rhino build,
    // pulling a ClientChatReceivedEvent out of `arguments` (which is what a
    // `...args` rest parameter compiles to) throws
    // "InternalError: Invalid JavaScript value" and silently kills the handler.
    register("chat", (event) => {
        // @ts-expect-error CTAutocomplete's chat trigger event type is too narrow here.
        const msg = ChatLib.getChatMessage(event, false);
        if (typeof msg !== "string") return;
        const uuid = getHousingUuid();
        if (uuid === null) return;

        let m = msg.match(/^Created (function|region) (.+)!$/);
        if (m !== null) {
            writePresence(uuid, importableType(m[1]), m[2]);
            return;
        }
        m = msg.match(/^Deleted the (function|region) (.+)$/);
        if (m !== null) {
            deleteImportableCache(uuid, importableType(m[1]), m[2]);
            return;
        }
        m = msg.match(/^Renamed (function|region) (.+) to (.+)$/);
        if (m !== null) {
            // A name containing " to " makes the split ambiguous; leave it for a
            // rescan rather than trust the heuristic.
            if (m[2].indexOf(" to ") !== -1 || m[3].indexOf(" to ") !== -1) return;
            deleteImportableCache(uuid, importableType(m[1]), m[2]);
            writePresence(uuid, importableType(m[1]), m[3]);
            return;
        }
        // Menus are keyed by title. Deletion ("Deleted the custom menu") carries
        // no title and a retitle has no captured confirmation, so both wait for
        // the next rescan.
        m = msg.match(/^Created custom menu with the title (.+)!$/);
        if (m !== null) writePresence(uuid, "MENU", m[1]);
    });
}

function importableType(word: string): "FUNCTION" | "REGION" {
    return word === "function" ? "FUNCTION" : "REGION";
}
