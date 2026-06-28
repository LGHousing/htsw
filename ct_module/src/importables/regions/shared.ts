import TaskContext from "../../tasks/context";
import { unique } from "../../utils/helpers";
import {
    chatMessage,
    oneOf,
    regionCreated,
    regionEditorOpened,
} from "../waiters";

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
    onEach?: (name: string) => void
): Promise<void> {
    const names = unique(regionNames);
    if (names.length === 0) return;

    for (const name of names) {
        const status = await openRegionEditor(ctx, name);
        if (status === "opened") {
            // Region exists — nothing to do. No clickGoBack: /region edit opens a
            // parent-less "Close" menu; the next iteration/command replaces it.
            onEach?.(name);
            continue;
        }
        await ctx.runCommand(`/pos1`);
        await ctx.runCommand(`/pos2`);

        await ctx.expectAfter(
            () => ctx.runCommand(`/region create ${name}`),
            regionCreated(name)
        );
        onEach?.(name);
    }
}
