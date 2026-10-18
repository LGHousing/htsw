import type { Action, ImportableMenu } from "htsw/types";

import TaskContext from "../../../tasks/context";
import type { ItemFieldContent } from "../../items/fieldContent";
import type { ProgressScope } from "../../syncEvents";
import type { Observed } from "../../observedActions";
import type { ChildAction, ChildActionListDiff } from "../diff/types";
import type { ActionSyncContext } from "../syncContext";

export type PlannedChildActionList = {
    desired: ChildAction[];
    observed: ReadonlyArray<Observed<ChildAction> | null>;
    diff: ChildActionListDiff;
};

export type ApplyChildActionList = (
    ctx: TaskContext,
    plan: PlannedChildActionList,
    options: {
        reopenList?: () => Promise<void>;
        sync: ActionSyncContext;
        progressScope: ProgressScope;
        listPath: import("../../actionPath").ActionListPath;
    }
) => Promise<void>;

export type ActionListApplyResult = {
    /** True once application may have changed this list. */
    readonly mutationStarted?: true;
    /** Confirmed menu slots, collected across lists before a failure. */
    readonly menuSnapshot?: ImportableMenu;
    readonly currentSnapshot: ReadonlyArray<Action | Observed | null>;
    readonly itemContent?: ItemFieldContent;
};
