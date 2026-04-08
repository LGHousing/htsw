import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Action, Condition, Event } from "../../types";

type Check = (gcx: GlobalCtxt, action: Action) => void;

const EVENT_SCOPED_CONDITIONS: Partial<Record<Condition["type"], Event[]>> = {
    COMPARE_DAMAGE: ["Player Damage"],
    DAMAGE_CAUSE: ["Player Damage"],
    PVP_ENABLED: ["PvP State Change"],
    FISHING_ENVIRONMENT: ["Fish Caught"],
    PORTAL_TYPE: ["Player Enter Portal"],
    BLOCK_TYPE: ["Player Block Break"],
    IS_ITEM: [
        "Player Drop Item",
        "Player Pick Up Item",
        "Player Change Held Item",
    ],
};

export function checkActionContext(gcx: GlobalCtxt) {
    for (const importable of gcx.importables) {
        if (importable.type === "FUNCTION") {
            checkAll(gcx, checkActionInFunction, importable.actions);
        }

        else if (importable.type === "EVENT") {
            checkAll(gcx, checkActionInEvent(importable.event), importable.actions);
        }

        else if (importable.type === "ITEM") {
            checkAll(gcx, checkActionInItem, importable.leftClickActions ?? []);
            checkAll(gcx, checkActionInItem, importable.rightClickActions ?? []);
        }

        else if (importable.type === "REGION") {
            checkAll(gcx, checkActionInRegion, importable.onEnterActions ?? []);
            checkAll(gcx, checkActionInRegion, importable.onExitActions ?? []);
        }
    }
}

function checkAll(gcx: GlobalCtxt, check: Check, actions: Action[]) {
    for (const action of actions) {
        check(gcx, action);

        if (action.type === "CONDITIONAL") {
            checkAll(gcx, check, action.ifActions);
            checkAll(gcx, check, action.elseActions ?? []);
        }

        else if (action.type === "RANDOM") {
            checkAll(gcx, check, action.actions);
        }
    }
}

function checkActionInFunction(gcx: GlobalCtxt, action: Action) {
    checkNotCancelEvent(gcx, action, "functions");
    checkConditionScopes(gcx, action, undefined);
}

const CANCELLABLE_EVENTS: Event[] = [
    "Player Death", "Fish Caught", "Player Damage", "Player Drop Item",
    "Player Pick Up Item",  "Player Change Held Item", "Player Toggle Sneak",
    "Player Toggle Flight"
];

function checkActionInEvent(event: Event) {
    return (gcx: GlobalCtxt, action: Action) => {
        if (action.type === "KILL") {
            gcx.addDiagnostic(
                Diagnostic.error("Kill Player action cannot be used inside events")
                    .addPrimarySpan(gcx.spans.getField(action, "type"))
            );
        }

        if (!CANCELLABLE_EVENTS.includes(event) && action.type === "CANCEL_EVENT") {
            gcx.addDiagnostic(
                Diagnostic.error(`${event} event cannot be cancelled.`)
                    .addPrimarySpan(gcx.spans.getField(action, "type"))
            );
        }

        checkConditionScopes(gcx, action, event);
    };
}

function checkActionInRegion(gcx: GlobalCtxt, action: Action) {
    checkNotCancelEvent(gcx, action, "regions");
    checkConditionScopes(gcx, action, undefined);
}

function checkActionInItem(gcx: GlobalCtxt, action: Action) {
    checkNotCancelEvent(gcx, action, "items");
    checkConditionScopes(gcx, action, undefined);

    if (action.type === "CONDITIONAL") {
        gcx.addDiagnostic(
            Diagnostic.error(`Conditional action cannot be used inside items`)
                .addPrimarySpan(gcx.spans.getField(action, "type"))
        );
    }
}

function checkNotCancelEvent(gcx: GlobalCtxt, action: Action, context: string) {
    if (action.type === "CANCEL_EVENT") {
        gcx.addDiagnostic(
            Diagnostic.error(`Cancel Event action cannot be used inside ${context}`)
                .addPrimarySpan(gcx.spans.getField(action, "type"))
        );
    }
}

function checkConditionScopes(
    gcx: GlobalCtxt,
    action: Action,
    event: Event | undefined,
) {
    if (action.type !== "CONDITIONAL") {
        return;
    }

    for (const condition of action.conditions) {
        const allowedEvents = EVENT_SCOPED_CONDITIONS[condition.type];
        if (!allowedEvents) {
            continue;
        }

        if (event && allowedEvents.includes(event)) {
            continue;
        }

        const context = event ? `${event} event` : "this context";
        const allowed = allowedEvents.join(", ");

        gcx.addDiagnostic(
            Diagnostic.error(
                `${condition.type} condition can only be used inside: ${allowed}. It cannot be used in ${context}.`
            ).addPrimarySpan(gcx.spans.getField(condition, "type"))
        );
    }
}
