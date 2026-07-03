import type { Pos } from "htsw/types";

import type { TaskWaiter } from "../tasks/context";
import type TaskContext from "../tasks/context";
import type { WaitForPromise } from "../tasks/specifics/waitFor";
import { allOf } from "../tasks/waiters";
import { removedFormatting } from "../utils/helpers";
import { chatMessage, menuOpened } from "../housingSync/menus/menuWaiters";

export function functionActionEditorOpened(name: string): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: `Waiting for function editor ${name}`,
        items: ["Add Action"],
    });
}

export function functionListOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: "Waiting for functions list",
        items: ["Create Function"],
    });
}

export function menuSettingsOpened(name: string): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: `Waiting for menu settings ${name}`,
        items: ["Edit Menu Elements", "Change Menu Size"],
    });
}

export function menuCreated(name: string): TaskWaiter<{
    message: void;
    editor: void;
}> {
    return allOf({
        message: chatMessage(`Created custom menu with the title ${name}!`),
        editor: menuSettingsOpened(name),
    });
}

export function menuListOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: "Waiting for menu list",
        items: ["Create Menu"],
    });
}

export function regionEditorOpened(name: string): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: `Waiting for region editor ${name}`,
        items: ["Entry Actions", "Exit Actions"],
    });
}

export function regionCreated(name: string): TaskWaiter<void> {
    return chatMessage(`Created region ${name}!`);
}

export function regionMovedToSelection(): TaskWaiter<void> {
    return chatMessage("Updated region to your current selection!", "messageClickWait");
}

export function regionCornerSet(pos: Pos, corner: "A" | "B"): TaskWaiter<void> {
    const successMessage = `Position ${corner} set to ${pos.x}, ${pos.y}, ${pos.z}.`;
    return {
        label: "Waiting for region corner result",
        start(ctx: TaskContext): WaitForPromise<void> {
            let failureMessage: string | null = null;
            const waiter = ctx.withTimeout(
                ctx.waitFor("message", (message) => {
                    const text = removedFormatting(message);
                    if (text === successMessage) return true;
                    if (
                        text === "You cannot select outside the plot!" ||
                        text === "Please use the selection tool to select a region!"
                    ) {
                        failureMessage = text;
                        return true;
                    }
                    return false;
                }),
                "Waiting for region corner result"
            );
            const mapped = waiter.then(() => {
                if (failureMessage !== null) {
                    throw new Error(`Failed to set region corner: ${failureMessage}`);
                }
            }) as WaitForPromise<void>;
            mapped.cleanupWaiter = waiter.cleanupWaiter;
            mapped.catch(() => {});
            return mapped;
        },
    };
}

export function regionListOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: "Waiting for region list",
        items: ["Create Region"],
    });
}

export function eventActionsOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: "Waiting for event actions list",
        title: "Event Actions",
    });
}

export function itemEditorOpened(): TaskWaiter<void> {
    return menuOpened({
        kind: "commandMenuWait",
        label: "Waiting for item editor",
        items: ["Edit Actions"],
    });
}

export function teleportSucceeded(pos: Pos): TaskWaiter<void> {
    return chatMessage(`Teleporting you to ${pos.x}, ${pos.y}, ${pos.z}.`);
}
