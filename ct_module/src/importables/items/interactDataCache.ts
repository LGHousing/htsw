import type { ImportableItem } from "htsw/types";

import type { InteractDataExpectation } from "../../housingSync/itemCapture";
import { interactDataCachePath } from "../../importCache/paths";
import { ensureParentDirs } from "../../utils/filesystem";
import type { ItemDependencyIndex } from "../itemDependencyIndex";

function hasClickActions(item: ImportableItem): boolean {
    return (
        (item.leftClickActions?.length ?? 0) > 0 ||
        (item.rightClickActions?.length ?? 0) > 0
    );
}

export function expectedInteractData(
    item: ImportableItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string | undefined
): InteractDataExpectation {
    if (!hasClickActions(item)) return { kind: "absent" };
    if (housingUuid === undefined) return { kind: "uncached" };
    const path = interactDataCachePath(
        housingUuid,
        dependencies.clickActionsFingerprint(item)
    );
    try {
        if (!FileLib.exists(path)) return { kind: "uncached" };
        const snbt = FileLib.read(path) as unknown as string | null;
        return snbt === null
            ? { kind: "uncached" }
            : { kind: "cached", snbt };
    } catch (_error) {
        return { kind: "uncached" };
    }
}

export function writeInteractDataCache(
    item: ImportableItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string,
    interactDataSnbt: string
): void {
    if (!hasClickActions(item)) return;
    const path = interactDataCachePath(
        housingUuid,
        dependencies.clickActionsFingerprint(item)
    );
    ensureParentDirs(path);
    FileLib.write(path, interactDataSnbt, true);
}
