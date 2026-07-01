import type { Condition } from "htsw/types";

import type { ItemRegistry } from "../../../../importables/itemRegistry";
import type { ProgressHandler } from "../../../progress/types";

export type ApplyConditionListOptions = {
    itemRegistry: ItemRegistry;
    baselineCurrent?: ReadonlyArray<Condition | null>;
    progress?: ProgressHandler;
};
