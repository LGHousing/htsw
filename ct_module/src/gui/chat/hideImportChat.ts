/// <reference types="../../../CTAutocomplete" />

import { getHideImportChat } from "@htsw/importer/settings";
import { isTaskRunning } from "@htsw/importer/tasks/runningState";
import { CHAT_INPUT_PROMPT } from "@htsw/importer/housingSync/menus/menuUtils";

// Housing chat an import answers or confirms by itself, so the player never
// has to act on it. Refusals and errors are left out on purpose.
const IMPORT_CHAT = [
    /^Created (function|region) .+!$/,
    /^Created custom menu with the title .+!$/,
    /^Updated region to your current selection!$/,
    /^Position [AB] set to .+\.$/,
    /^Added action .+!$/,
    /^This function will (now|no longer) automatically execute.*!$/,
];

function isImportChat(message: string): boolean {
    if (message.indexOf(CHAT_INPUT_PROMPT) !== -1) return true;
    for (let i = 0; i < IMPORT_CHAT.length; i++) {
        if (IMPORT_CHAT[i].test(message)) return true;
    }
    return false;
}

export function initImportChatHiding(): void {
    // Lowest priority so every other HTSW chat trigger, including the import's
    // own wait for the prompt, has read the message before it is hidden. They
    // would still run after a cancel (chat triggers default to
    // triggerIfCanceled), but this keeps the order obvious.
    register("chat", (event) => {
        if (!getHideImportChat() || !isTaskRunning()) return;
        // @ts-expect-error CTAutocomplete's chat trigger event type is too narrow here.
        const message = ChatLib.getChatMessage(event, false);
        if (typeof message === "string" && isImportChat(message)) cancel(event);
    }).setPriority(OnTrigger.Priority.LOWEST);
}
