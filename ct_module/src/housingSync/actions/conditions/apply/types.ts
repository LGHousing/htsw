import type { Condition } from "htsw/types";

import type { ItemRegistry } from "../../../../importables/itemRegistry";
import type { ProgressHandler } from "../../../progress/types";
import type { ItemDiffContext } from "../../diff/itemDiffContext";
import type { ItemFieldObservationRecorder } from "../../../itemFieldObservations";

export type ApplyConditionListOptions = {
    itemRegistry: ItemRegistry;
    baselineCurrent?: ReadonlyArray<Condition | null>;
    progress?: ProgressHandler;
    itemDiff?: ItemDiffContext;
    itemFieldObservations?: ItemFieldObservationRecorder;
};
