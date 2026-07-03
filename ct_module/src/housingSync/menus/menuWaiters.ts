import type { TaskWaiter } from "../../tasks/context";
import type TaskContext from "../../tasks/context";
import type { WaitForPromise } from "../../tasks/specifics/waitFor";
import { removedFormatting } from "../../utils/helpers";
import { COST } from "../progress/costs";
import { timed } from "../progress/timing";
import { timedWaitForMenu } from "./menuWait";

type MenuWaitKind = "menuClickWait" | "pageTurnWait" | "goBackWait" | "commandMenuWait";
type MessageWaitKind = "commandMessageWait" | "messageClickWait";
type TextMatch = string | ((text: string) => boolean);

export type MenuOpenedOptions = {
    kind?: MenuWaitKind;
    label?: string;
    title?: TextMatch;
    items?: readonly TextMatch[];
};

function textMatches(text: string, match: TextMatch): boolean {
    return typeof match === "string" ? text === match : match(text);
}

function itemExists(ctx: TaskContext, match: TextMatch): boolean {
    return ctx.tryGetMenuItemSlot((slot) => {
        const item = slot.getItem();
        if (item === null || item === undefined) return false;
        return textMatches(removedFormatting(item.getName()), match);
    }) !== null;
}

function openMenuMatches(ctx: TaskContext, options: MenuOpenedOptions): boolean {
    if (options.title !== undefined) {
        const title = ctx.getOpenContainerTitle();
        if (title === null || !textMatches(title, options.title)) return false;
    }

    const items = options.items ?? [];
    for (let i = 0; i < items.length; i++) {
        if (!itemExists(ctx, items[i])) return false;
    }

    return true;
}

function describeTextMatch(match: TextMatch): string {
    return typeof match === "string" ? `"${match}"` : "<predicate>";
}

function menuOpenedLabel(options: MenuOpenedOptions): string {
    if (options.label !== undefined) return options.label;
    const parts: string[] = [];
    if (options.title !== undefined) parts.push(`title ${describeTextMatch(options.title)}`);
    const items = options.items ?? [];
    for (let i = 0; i < items.length; i++) {
        parts.push(`item ${describeTextMatch(items[i])}`);
    }
    return parts.length === 0
        ? "Waiting for menu to open"
        : `Waiting for menu with ${parts.join(", ")}`;
}

export function chatMessage(
    message: string,
    kind: MessageWaitKind = "commandMessageWait"
): TaskWaiter<void> {
    return {
        label: `Waiting for chat message "${message}"`,
        start(ctx: TaskContext): WaitForPromise<void> {
            return timed(
                kind,
                kind === "messageClickWait" ? COST.messageClickWait : COST.commandMessageWait,
                () => {
                    const waiter = ctx.withTimeout(
                        ctx.waitFor(
                            "message",
                            (chatMessage) => removedFormatting(chatMessage) === message
                        ),
                        "Waiting for message in chat"
                    );
                    const mapped = waiter.then(() => undefined) as WaitForPromise<void>;
                    mapped.cleanupWaiter = waiter.cleanupWaiter;
                    mapped.catch(() => {});
                    return mapped;
                }
            );
        },
    };
}

export function menuOpened(
    options: MenuOpenedOptions = {}
): TaskWaiter<void> {
    return {
        label: menuOpenedLabel(options),
        start(ctx: TaskContext): WaitForPromise<void> {
            const kind = options.kind ?? "menuClickWait";
            let waiter: WaitForPromise<void> | null = null;
            let stopped = false;
            const promise = (async (): Promise<void> => {
                while (!stopped) {
                    waiter = timedWaitForMenu(ctx, kind);
                    await waiter;
                    waiter = null;
                    if (openMenuMatches(ctx, options)) return;
                }
                throw new Error(`${menuOpenedLabel(options)} was cancelled`);
            })() as WaitForPromise<void>;
            promise.cleanupWaiter = () => {
                stopped = true;
                waiter?.cleanupWaiter?.();
            };
            promise.catch(() => {});
            return promise;
        },
    };
}
