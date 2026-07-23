import type { Action, Condition } from "htsw/types";

import type { ItemDependencyIndex } from "./dependencyIndex";
import type { ProjectItem } from "./projectItems";
import type { ItemFieldObservationRecorder } from "../../housingSync/items/fieldObservations";
import { canonicalItemShellTagKey } from "../../housingSync/items/itemNbt";
import { expectedInteractData, itemInteractDataMatches } from "./interactDataCache";

export function itemFieldObservationMatches(
    observations: ItemFieldObservationRecorder | undefined,
    observed: Action | Condition,
    property: string,
    entry: ProjectItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string | undefined
): boolean {
    if (observations === undefined) return false;
    const observation = observations.get(observed, property);
    if (
        observation === undefined ||
        observation.canonicalKey !== canonicalItemShellTagKey(entry.nbt)
    ) {
        return false;
    }
    const item = entry.importable;
    const expectation =
        item === undefined
            ? { kind: "absent" as const }
            : expectedInteractData(item, dependencies, housingUuid);
    return itemInteractDataMatches(observation.snbt, expectation);
}
