import type { Condition } from "htsw/types";

import type { ResolveItemField } from "../../../items/itemReferences";
import type { ProgressHandler } from "../../../progress/types";
import type { ItemDiffContext } from "../../diff/itemDiffContext";

export type ApplyConditionListOptions = {
    resolveItem: ResolveItemField;
    baselineCurrent?: ReadonlyArray<Condition | null>;
    progress?: ProgressHandler;
    itemDiff?: ItemDiffContext;
};
