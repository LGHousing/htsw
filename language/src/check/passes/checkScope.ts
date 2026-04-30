import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Action, Condition, Event } from "../../types";
import { ACTION_NAMES } from "../../types";

type ActionContainer = "functions" | "events" | "items" | "menus" | "regions" | "npcs";
type NestedActionContainer = "conditional" | "random";

type ActionScope = {
    container: ActionContainer;
    event?: Event;
    nested?: NestedActionContainer;
};

type Check = (gcx: GlobalCtxt, action: Action, scope: ActionScope) => void;

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

const EVENT_FORBIDDEN_ACTIONS: Partial<Record<Event, Action["type"][]>> = {
    "Player Quit": [
        "SET_GROUP",
        "HEAL",
        "TITLE",
        "ACTION_BAR",
        "RESET_INVENTORY",
        "CHANGE_MAX_HEALTH",
        "PARKOUR_CHECKPOINT",
        "GIVE_ITEM",
        "REMOVE_ITEM",
        "MESSAGE",
        "APPLY_POTION_EFFECT",
        "CLEAR_POTION_EFFECTS",
        "GIVE_EXPERIENCE_LEVELS",
        "TELEPORT",
        "FAIL_PARKOUR",
        "PLAY_SOUND",
        "SET_COMPASS_TARGET",
        "SET_GAMEMODE",
        "CHANGE_HEALTH",
        "CHANGE_HUNGER",
        "APPLY_INVENTORY_LAYOUT",
        "ENCHANT_HELD_ITEM",
        "SET_TEAM",
        "SET_MENU",
        "DROP_ITEM",
        "SET_VELOCITY",
        "LAUNCH",
        "SET_PLAYER_WEATHER",
        "SET_PLAYER_TIME",
        "TOGGLE_NAMETAG_DISPLAY",
    ],
    "Group Change": ["SET_GROUP"],
};

const ALL_EVENT_FORBIDDEN_ACTIONS: Action["type"][] = [
    "KILL",
    "SEND_TO_LOBBY",
];

const NESTED_CONTAINER_FORBIDDEN_ACTIONS: Action["type"][] = [
    "CONDITIONAL",
    "RANDOM",
];

export function checkActionContext(gcx: GlobalCtxt) {
    for (const importable of gcx.importables) {
        if (importable.type === "FUNCTION") {
            checkAll(gcx, checkActionInFunction, importable.actions, { container: "functions" });
        }

        else if (importable.type === "EVENT") {
            checkAll(gcx, checkActionInEvent, importable.actions, {
                container: "events",
                event: importable.event,
            });
        }

        else if (importable.type === "ITEM") {
            checkAll(gcx, checkActionInItem, importable.leftClickActions ?? [], { container: "items" });
            checkAll(gcx, checkActionInItem, importable.rightClickActions ?? [], { container: "items" });
        }

        else if (importable.type === "MENU") {
            for (const slot of importable.slots) {
                checkAll(gcx, checkActionInMenu, slot.actions ?? [], { container: "menus" });
            }
        }

        else if (importable.type === "REGION") {
            checkAll(gcx, checkActionInRegion, importable.onEnterActions ?? [], { container: "regions" });
            checkAll(gcx, checkActionInRegion, importable.onExitActions ?? [], { container: "regions" });
        }

        else if (importable.type === "NPC") {
            checkAll(gcx, checkActionInNpc, importable.leftClickActions ?? [], { container: "npcs" });
            checkAll(gcx, checkActionInNpc, importable.rightClickActions ?? [], { container: "npcs" });
        }
    }
}

function checkAll(gcx: GlobalCtxt, check: Check, actions: Action[], scope: ActionScope) {
    for (const action of actions) {
        check(gcx, action, scope);

        if (action.type === "CONDITIONAL") {
            checkAll(gcx, check, action.ifActions, { ...scope, nested: "conditional" });
            checkAll(gcx, check, action.elseActions, { ...scope, nested: "conditional" });
        }

        else if (action.type === "RANDOM") {
            checkAll(gcx, check, action.actions, { ...scope, nested: "random" });
        }
    }
}

function checkActionInFunction(gcx: GlobalCtxt, action: Action, scope: ActionScope) {
    checkNestedScope(gcx, action, scope);
    checkNotCancelEvent(gcx, action, "functions");
    checkConditionScopes(gcx, action, undefined);
    checkNotItemOnly(gcx, action, "functions");
    checkNotMenuOnly(gcx, action, "functions");
    checkExitScope(gcx, action, scope);
}

const CANCELLABLE_EVENTS: Event[] = [
    "Player Death", "Fish Caught", "Player Damage", "Player Drop Item",
    "Player Pick Up Item",  "Player Change Held Item", "Player Toggle Sneak",
    "Player Toggle Flight"
];

const ITEM_ONLY_ACTIONS: Partial<Record<Action["type"], string>> = {
    USE_HELD_ITEM: "Use/Remove Held Item",
};

const MENU_ONLY_ACTIONS: Partial<Record<Action["type"], string>> = {
    CLOSE_MENU: "Close Menu",
};

function checkActionInEvent(gcx: GlobalCtxt, action: Action, scope: ActionScope) {
    const event = scope.event;
    if (!event) {
        return;
    }

    checkNestedScope(gcx, action, scope);

    if (ALL_EVENT_FORBIDDEN_ACTIONS.includes(action.type)) {
        gcx.addDiagnostic(
            Diagnostic.error(`${ACTION_NAMES[action.type]} action cannot be used inside events`)
                .addPrimarySpan(gcx.spans.getField(action, "type"))
        );
    }

    if (!CANCELLABLE_EVENTS.includes(event) && action.type === "CANCEL_EVENT") {
        gcx.addDiagnostic(
            Diagnostic.error(`${event} event cannot be cancelled.`)
                .addPrimarySpan(gcx.spans.getField(action, "type"))
        );
    }

    checkNotForbiddenInEvent(gcx, action, event);
    checkConditionScopes(gcx, action, event);
    checkNotItemOnly(gcx, action, "events");
    checkNotMenuOnly(gcx, action, "events");
    checkExitScope(gcx, action, scope);
}

function checkActionInRegion(gcx: GlobalCtxt, action: Action, scope: ActionScope) {
    checkNestedScope(gcx, action, scope);
    checkNotCancelEvent(gcx, action, "regions");
    checkConditionScopes(gcx, action, undefined);
    checkNotItemOnly(gcx, action, "regions");
    checkNotMenuOnly(gcx, action, "regions");
    checkExitScope(gcx, action, scope);
}

function checkActionInItem(gcx: GlobalCtxt, action: Action, scope: ActionScope) {
    checkNestedScope(gcx, action, scope);
    checkNotCancelEvent(gcx, action, "items");
    checkConditionScopes(gcx, action, undefined);
    checkNotMenuOnly(gcx, action, "items");
    checkExitScope(gcx, action, scope);

    if (action.type === "CONDITIONAL" || action.type === "RANDOM") {
        gcx.addDiagnostic(
            Diagnostic.error(`${ACTION_NAMES[action.type]} action cannot be used inside items`)
                .addPrimarySpan(gcx.spans.getField(action, "type"))
        );
    }
}

function checkActionInMenu(gcx: GlobalCtxt, action: Action, scope: ActionScope) {
    checkNestedScope(gcx, action, scope);
    checkNotCancelEvent(gcx, action, "menus");
    checkConditionScopes(gcx, action, undefined);
    checkNotItemOnly(gcx, action, "menus");
    checkExitScope(gcx, action, scope);
}

function checkActionInNpc(gcx: GlobalCtxt, action: Action, scope: ActionScope) {
    checkNestedScope(gcx, action, scope);
    checkNotCancelEvent(gcx, action, "npcs");
    checkConditionScopes(gcx, action, undefined);
    checkNotMenuOnly(gcx, action, "npcs");
    checkExitScope(gcx, action, scope);
}

function checkNotCancelEvent(gcx: GlobalCtxt, action: Action, context: string) {
    if (action.type === "CANCEL_EVENT") {
        gcx.addDiagnostic(
            Diagnostic.error(`Cancel Event action cannot be used inside ${context}`)
                .addPrimarySpan(gcx.spans.getField(action, "type"))
        );
    }
}

function checkNotItemOnly(gcx: GlobalCtxt, action: Action, context: string) {
    const displayName = ITEM_ONLY_ACTIONS[action.type];
    if (displayName) {
        gcx.addDiagnostic(
            Diagnostic.error(`${displayName} action can only be used inside items`)
                .addPrimarySpan(gcx.spans.getField(action, "type"))
                .addSecondarySpan(gcx.spans.getField(action, "type"), context)
        );
    }
}

function checkNotMenuOnly(gcx: GlobalCtxt, action: Action, context: string) {
    const displayName = MENU_ONLY_ACTIONS[action.type];
    if (displayName) {
        gcx.addDiagnostic(
            Diagnostic.error(`${displayName} action can only be used inside menus`)
                .addPrimarySpan(gcx.spans.getField(action, "type"))
                .addSecondarySpan(gcx.spans.getField(action, "type"), context)
        );
    }
}

function checkNotForbiddenInEvent(gcx: GlobalCtxt, action: Action, event: Event) {
    if (!EVENT_FORBIDDEN_ACTIONS[event]?.includes(action.type)) {
        return;
    }

    gcx.addDiagnostic(
        Diagnostic.error(`${ACTION_NAMES[action.type]} action cannot be used inside ${event} events`)
            .addPrimarySpan(gcx.spans.getField(action, "type"))
    );
}

function checkNestedScope(gcx: GlobalCtxt, action: Action, scope: ActionScope) {
    if (!scope.nested || !NESTED_CONTAINER_FORBIDDEN_ACTIONS.includes(action.type)) {
        return;
    }

    gcx.addDiagnostic(
        Diagnostic.error(`${ACTION_NAMES[action.type]} action cannot be used inside ${scope.nested} actions`)
            .addPrimarySpan(gcx.spans.getField(action, "type"))
    );
}

function checkExitScope(gcx: GlobalCtxt, action: Action, scope: ActionScope) {
    if (action.type !== "EXIT" || scope.nested) {
        return;
    }

    gcx.addDiagnostic(
        Diagnostic.error("Exit action can only be used inside conditional or random actions")
            .addPrimarySpan(gcx.spans.getField(action, "type"))
    );
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
