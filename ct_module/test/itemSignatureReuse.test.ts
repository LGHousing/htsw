import { afterEach, expect, test, vi } from "vitest";
import * as htsw from "htsw";
import type { ImportableItem } from "htsw/types";

vi.mock("../src/utils/nbt", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/nbt")>()),
    getItemFromNbt: (nbt: unknown) => ({ nbt }),
    itemWithInteractData: (nbt: unknown, signature: string) => ({ nbt, signature }),
}));

import {
    applyImportableItemPlan,
    itemApplicationPlan,
    planImportableItem,
    readImportableItem,
} from "@htsw/importer/importables/items/import";
import { ApplicationProgress } from "@htsw/importer/importables/import/applicationProgress";
import type { ImportContext } from "@htsw/importer/importables/import/context";
import type TaskContext from "@htsw/importer/tasks/context";
import { createItemDependencyIndex } from "@htsw/importer/importables/items/dependencyIndex";
import { createProjectItemIndex } from "@htsw/importer/importables/items/projectItems";

afterEach(() => vi.unstubAllGlobals());

test("a planned rebuild reuses a signature cached by an earlier item", async () => {
    const first: ImportableItem = {
        type: "ITEM",
        name: "first",
        nbt: htsw.nbt.parseSnbtText('{id:"minecraft:stone"}'),
        rightClickActions: [{ type: "FUNCTION", function: "Check", global: false }],
    };
    const second = {
        ...first,
        name: "second",
        nbt: htsw.nbt.parseSnbtText('{id:"minecraft:paper",tag:{HideFlags:127}}'),
    };
    const items = [first, second];
    const itemDependencies = createItemDependencyIndex(items, createProjectItemIndex(items));
    const files = new Map<string, string>();
    const write = vi.fn();
    vi.stubGlobal("FileLib", {
        exists: (path: string) => files.has(path),
        read: (path: string) => files.get(path),
        write,
    });
    const place = vi.fn(async () => undefined);
    const session = {
        housingUuid: "house",
        itemDependencies,
        itemPlacement: { place },
        actions: { trust: { trustMode: false } },
    } as unknown as ImportContext;
    const ctx = {} as TaskContext;
    const plan = planImportableItem(await readImportableItem(ctx, second, session));
    expect(plan.rightPlan).not.toBeNull();

    const signature = '{signature:"first"}';
    files.set(
        `./htsw/.cache/house/interact_data/${itemDependencies.clickActionsFingerprint(first)}.snbt`,
        signature
    );
    const progress = new ApplicationProgress(itemApplicationPlan(plan), undefined);
    await applyImportableItemPlan(ctx, plan, session, progress);
    progress.complete("cache");
    progress.assertComplete();

    expect(place).toHaveBeenCalledExactlyOnceWith(ctx, { nbt: second.nbt, signature });
    expect(write).not.toHaveBeenCalled();
});
