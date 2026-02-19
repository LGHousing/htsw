import { ACTION_NAMES, Action, SOUNDS } from "htsw/types";
import TaskContext from "../tasks/context";

export function booleanAsValue(value: boolean): string {
    return value ? "Enabled" : "Disabled";
}

export function numberAsValue(value: number): string {
    return value.toString();
}

export function stringAsValue(value: string): string {
    return value;
}

// TODO export this if needed, else remove
function soundPathToName(path: string): string | null {
    for (const sound of SOUNDS) {
        if (sound.path === path) return sound.name;
    }
    return null;
}

export async function waitForMenuToLoad(ctx: TaskContext): Promise<void> {
    // TODO waitFor packetReceived with timeout
    // await ctx.withTimeout(2000, "Waiting for menu to load", ctx.waitFor("packetReceived", (packet) => {
    //     // TODO fill in this predicate or something similar
    // }));
    await ctx.sleep(500);
}

export function clickSlot(ctx: TaskContext, identifier: string): boolean {
    const slot = ctx.findItemSlot(identifier);
    if (slot === null) return false;

    slot.click();
    return true;
}

export function clickSlotOrError(ctx: TaskContext, identifier: string): void {
    const found = clickSlot(ctx, identifier);
    if (!found) {
        throw new Error(`Could not find slot with identifier '${identifier}'`);
    }
}

export async function clickSlotMaybePaginate(
    ctx: TaskContext,
    identifier: string
): Promise<boolean> {
    do {
        const found = clickSlot(ctx, identifier);
        if (found) return true;

        const wentToNextPage = clickSlot(ctx, "next page");
        if (!wentToNextPage) break;
        await waitForMenuToLoad(ctx);
    } while (true);

    return false;
}

export async function clickSlotMaybePaginateOrError(
    ctx: TaskContext,
    identifier: string
): Promise<void> {
    const found = await clickSlotMaybePaginate(ctx, identifier);
    if (!found) {
        throw new Error(`Could not find slot with identifier '${identifier}'`);
    }
}

export function goBack(ctx: TaskContext): void {
    clickSlot(ctx, "go back");
}
