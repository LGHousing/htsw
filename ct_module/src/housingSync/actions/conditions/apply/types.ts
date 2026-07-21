import type { Condition } from "htsw/types";

import type {
    CanonicalizeItemName,
    ResolveItemField,
} from "../../../items/itemReferences";
import type { ProgressHandler } from "../../../progress/types";
import type { ItemDiffContext } from "../../diff/itemDiffContext";
import type { ItemFieldObservationRecorder } from "../../../items/fieldObservations";

export type ApplyConditionListOptions = {
    canonicalizeItemName: CanonicalizeItemName;
    resolveItem: ResolveItemField;
    baselineCurrent?: ReadonlyArray<Condition | null>;
    progress?: ProgressHandler;
    itemDiff?: ItemDiffContext;
    itemFieldObservations?: ItemFieldObservationRecorder;
};
