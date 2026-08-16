/// <reference types="../../CTAutocomplete" />

import { getRestoreWorkspace, setRestoreWorkspace } from "../settings";
import { flushWorkspace, resetWorkspace } from "../persistence/workspace";
import { settingsFilePath } from "../persistence/settingsFiles";

const WORKSPACE_PATH = settingsFilePath("workspace.json");

/**
 * `/htsw workspace` — inspect and control the saved session.
 *
 * The escape hatch matters: a workspace that restores into a state the user
 * does not want is otherwise only fixable by finding and deleting a file
 * outside the game.
 */
export function commandWorkspace(args: string[]): void {
    const action = (args[0] ?? "status").toLowerCase();

    if (action === "reset") {
        const ok = resetWorkspace();
        if (!ok) {
            ChatLib.chat(`&c[htsw] Could not clear ${WORKSPACE_PATH}.`);
            return;
        }
        ChatLib.chat("&a[htsw] Saved workspace cleared. The next launch starts clean.");
        ChatLib.chat("&7[htsw] Your open projects and tabs are untouched for now.");
        return;
    }

    if (action === "on" || action === "off") {
        const enable = action === "on";
        setRestoreWorkspace(enable);
        if (enable) {
            ChatLib.chat("&a[htsw] Workspace restore enabled.");
        } else {
            ChatLib.chat("&e[htsw] Workspace restore disabled — nothing will be saved.");
        }
        return;
    }

    if (action === "save") {
        flushWorkspace();
        ChatLib.chat(`&a[htsw] Workspace written to ${WORKSPACE_PATH}.`);
        return;
    }

    if (action !== "status") {
        ChatLib.chat(`&cUnknown workspace action '${args[0]}'.`);
    }

    ChatLib.chat(
        getRestoreWorkspace()
            ? "&a[htsw] Workspace restore is ON."
            : "&e[htsw] Workspace restore is OFF."
    );
    ChatLib.chat(`&7[htsw] File: ${WORKSPACE_PATH}`);
    ChatLib.chat("&f/htsw workspace [status|reset|on|off|save]");
}
