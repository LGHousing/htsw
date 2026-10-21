import type TaskContext from "../../tasks/context";
import { unique } from "../../utils/helpers";
import { oneOf } from "../../tasks/waiters";
import { chatMessage } from "../../housingSync/menus/menuWaiters";
import { regionCreated, regionEditorOpened } from "../waiters";

export async function openRegionEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    const result = await ctx.expectAfter(
        () => ctx.runCommand(`/region edit ${name}`),
        oneOf({
            opened: regionEditorOpened(name),
            missing: chatMessage("Could not find a region with that name!"),
        })
    );

    return result;
}

export async function ensureRegionNamesExist(
    ctx: TaskContext,
    regionNames: readonly string[],
    onCreated?: (name: string) => void | Promise<void>
): Promise<void> {
    const names = unique(regionNames);
    if (names.length === 0) return;

    for (const name of names) {
        const status = await openRegionEditor(ctx, name);
        if (status === "opened") {
            // Region exists — nothing to do. No clickGoBack: /region edit opens a
            // parent-less "Close" menu; the next iteration/command replaces it.
            continue;
        }
        await ctx.runCommand(`/pos1`);
        await ctx.runCommand(`/pos2`);

        await ctx.expectAfter(
            () => ctx.runCommand(`/region create ${name}`),
            regionCreated(name)
        );
        await onCreated?.(name);
    }
}
