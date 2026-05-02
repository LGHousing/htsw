import type { ImportableRegion, Pos } from "htsw/types";

import { syncActionList } from "../../importer/actions";
import {
    clickGoBack,
    waitForMenu,
    waitForUnformattedMessage,
} from "../../importer/helpers";
import type { ImportableTrustPlan } from "../../knowledge";
import TaskContext from "../../tasks/context";
import { actionListTrustFor } from "../actionListTrust";
import type { ItemRegistry } from "../itemRegistry";
import { ensureReferencedImportablesExist } from "../references";
import { openRegionEditor } from "./shared";

export async function importImportableRegion(
    ctx: TaskContext,
    importable: ImportableRegion,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan
): Promise<void> {
    await ensureReferencedImportablesExist(ctx, importable);

    const setPos = async (pos: Pos, corner: "A" | "B") => {
        ctx.runCommand(`/tp ${pos.x} ${pos.y} ${pos.z}`);
        await waitForUnformattedMessage(
            ctx,
            `Teleporting you to ${pos.x}, ${pos.y}, ${pos.z}.`
        );

        ctx.runCommand(`//pos${corner}`);
        await waitForUnformattedMessage(
            ctx,
            `Position ${corner} set to ${pos.x}, ${pos.y}, ${pos.z}.`
        );
    };

    await setPos(importable.bounds.from, "A");
    await setPos(importable.bounds.to, "B");

    const alreadyExists = (await openRegionEditor(ctx, importable.name)) === "opened";

    if (!alreadyExists) {
        ctx.runCommand(`/region create ${importable.name}`);
        await waitForUnformattedMessage(ctx, `Created region ${importable.name}!`);

        await openRegionEditor(ctx, importable.name);
    } else {
        ctx.getItemSlot("Move Region").click();
        await waitForUnformattedMessage(ctx, "Updated region to your current selection!");

        await openRegionEditor(ctx, importable.name);
    }

    if (importable.onEnterActions && !trustPlan?.trustedListPaths.has("onEnterActions")) {
        ctx.getItemSlot("Entry Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.onEnterActions, {
            itemRegistry,
            trust: actionListTrustFor(
                trustPlan,
                "onEnterActions",
                importable.onEnterActions
            ),
        });

        if (
            importable.onExitActions &&
            !trustPlan?.trustedListPaths.has("onExitActions")
        ) {
            await clickGoBack(ctx);
        }
    }

    if (importable.onExitActions && !trustPlan?.trustedListPaths.has("onExitActions")) {
        ctx.getItemSlot("Exit Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.onExitActions, {
            itemRegistry,
            trust: actionListTrustFor(
                trustPlan,
                "onExitActions",
                importable.onExitActions
            ),
        });
    }
}
