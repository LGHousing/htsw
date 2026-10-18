import type { ResolveItemField } from "../../../items/itemReferences";
import type { ProgressHandler } from "../../../progress/types";

export type ApplyPlannedConditionListOptions = {
    reopenList?: () => Promise<void>;
    resolveItem: ResolveItemField;
    progress?: ProgressHandler;
};
