import type { ResolveItemField } from "../../../items/itemReferences";
import type { ProgressHandler } from "../../../progress/types";

export type ApplyPlannedConditionListOptions = {
    resolveItem: ResolveItemField;
    progress?: ProgressHandler;
};
