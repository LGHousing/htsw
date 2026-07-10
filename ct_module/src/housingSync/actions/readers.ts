import type {
    Action,
    ActionActionBar,
    ActionApplyInventoryLayout,
    ActionConditional,
    ActionDisplayMenu,
    ActionDropItem,
    ActionFailParkour,
    ActionFunction,
    ActionLaunch,
    ActionPauseExecution,
    ActionPlaySound,
    ActionRandom,
    ActionSetCompassTarget,
    ActionSendMessage,
    ActionTeleport,
    ActionTitle,
} from "htsw/types";

import TaskContext from "../../tasks/context";
import {
    clickGoBack,
    readBooleanValue,
    readStringValue,
} from "../menus/menuUtils";
import { waitForMenu } from "../menus/menuWait";
import {
    dropNotSetLocationIfOptional,
    getActionFieldLabel,
    getActionScalarLoreFields,
} from "../fields/actionMappings";
import {
    isTruncatableKind,
    looksTruncated,
    parseLocationField,
} from "../fields/loreParsing";
import type { ActionScalarFieldToRead, Observed, UiFieldKind } from "../types";
import type { ActionReadArgs } from "./specs";

export function refreshTruncatedScalarFields(
    ctx: TaskContext,
    current: Observed<Action>,
    fields: ActionScalarFieldToRead[] = getActionScalarLoreFields(current.type)
): void {
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (!isTruncatableKind(field.kind)) continue;
        const existing = (current as Record<string, unknown>)[field.prop];
        if (!fieldLooksTruncated(existing, field.kind)) continue;
        const slot = ctx.tryGetItemSlot(field.label);
        if (slot === null) continue;
        const value = readStringValue(slot);
        if (value === null) continue;
        if (field.kind === "location") {
            (current as Record<string, unknown>)[field.prop] = parseLocationField(value);
        } else {
            (current as Record<string, unknown>)[field.prop] = value;
        }
    }
}

function fieldLooksTruncated(value: unknown, kind: UiFieldKind): boolean {
    if (typeof value === "string") return looksTruncated(value);
    if (kind === "location" && typeof value === "object" && value !== null) {
        if ((value as { type?: unknown }).type === "Custom Coordinates") {
            const coord = (value as { value?: unknown }).value;
            return typeof coord === "string" && looksTruncated(coord);
        }
    }
    return false;
}

export async function readOpenConditional({
    ctx,
    childListsToRead,
    read,
    current,
}: ActionReadArgs<ActionConditional>): Promise<Observed<ActionConditional>> {
    const conditionsLabel = getActionFieldLabel("CONDITIONAL", "conditions");
    const matchAnyLabel = getActionFieldLabel("CONDITIONAL", "matchAny");
    const ifActionsLabel = getActionFieldLabel("CONDITIONAL", "ifActions");
    const elseActionsLabel = getActionFieldLabel("CONDITIONAL", "elseActions");

    const base: Observed<ActionConditional> = current ?? {
        type: "CONDITIONAL",
        matchAny: false,
        conditions: [],
        ifActions: [],
        elseActions: [],
    };
    if (childListsToRead.has("conditions")) {
        ctx.getMenuItemSlot(conditionsLabel).click();
        await waitForMenu(ctx);
        base.conditions = read === undefined
            ? []
            : await read.readConditions("conditions");
        await clickGoBack(ctx);
        read?.emitSnapshot();
    }

    base.matchAny = readBooleanValue(ctx.getMenuItemSlot(matchAnyLabel)) ?? false;

    if (childListsToRead.has("ifActions")) {
        ctx.getMenuItemSlot(ifActionsLabel).click();
        await waitForMenu(ctx);
        base.ifActions = read === undefined
            ? []
            : await read.readChildActions("ifActions");
        await clickGoBack(ctx);
        read?.emitSnapshot();
    }

    if (childListsToRead.has("elseActions")) {
        ctx.getMenuItemSlot(elseActionsLabel).click();
        await waitForMenu(ctx);
        base.elseActions = read === undefined
            ? []
            : await read.readChildActions("elseActions");
        await clickGoBack(ctx);
        read?.emitSnapshot();
    }

    return base;
}

export async function readOpenTitle({
    ctx,
    current,
}: ActionReadArgs<ActionTitle>): Promise<Observed<ActionTitle>> {
    const base: Observed<ActionTitle> =
        current ?? { type: "TITLE", title: "" };
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("TITLE", "title"),
        "title"
    );
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("TITLE", "subtitle"),
        "subtitle"
    );
    return base;
}

export async function readOpenActionBar({
    ctx,
    current,
}: ActionReadArgs<ActionActionBar>): Promise<Observed<ActionActionBar>> {
    const base: Observed<ActionActionBar> =
        current ?? { type: "ACTION_BAR", message: "" };
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("ACTION_BAR", "message"),
        "message"
    );
    return base;
}

export async function readOpenTeleport({
    ctx,
    current,
}: ActionReadArgs<ActionTeleport>): Promise<Observed<ActionTeleport>> {
    const base: Observed<ActionTeleport> =
        current ?? { type: "TELEPORT", location: { type: "Current Location" } };
    refreshLocationFromEditor(ctx, base, getActionFieldLabel("TELEPORT", "location"));
    return base;
}

export async function readOpenFailParkour({
    ctx,
    current,
}: ActionReadArgs<ActionFailParkour>): Promise<Observed<ActionFailParkour>> {
    const base: Observed<ActionFailParkour> =
        current ?? { type: "FAIL_PARKOUR" };
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("FAIL_PARKOUR", "message"),
        "message"
    );
    return base;
}

export async function readOpenPlaySound({
    ctx,
    current,
}: ActionReadArgs<ActionPlaySound>): Promise<Observed<ActionPlaySound>> {
    const base: Observed<ActionPlaySound> =
        current ?? { type: "PLAY_SOUND", sound: "random.orb" };
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("PLAY_SOUND", "sound"),
        "sound"
    );
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("PLAY_SOUND", "volume"),
        "volume"
    );
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("PLAY_SOUND", "pitch"),
        "pitch"
    );
    refreshLocationFromEditor(ctx, base, getActionFieldLabel("PLAY_SOUND", "location"));
    return base;
}

export async function readOpenSetCompassTarget({
    ctx,
    current,
}: ActionReadArgs<ActionSetCompassTarget>): Promise<Observed<ActionSetCompassTarget>> {
    const base: Observed<ActionSetCompassTarget> =
        current ?? { type: "SET_COMPASS_TARGET", location: { type: "Current Location" } };
    refreshLocationFromEditor(ctx, base, getActionFieldLabel("SET_COMPASS_TARGET", "location"));
    return base;
}

export async function readOpenRandom({
    ctx,
    read,
}: ActionReadArgs<ActionRandom>): Promise<Observed<ActionRandom>> {
    ctx.getMenuItemSlot(getActionFieldLabel("RANDOM", "actions")).click();
    await waitForMenu(ctx);
    const actions = read === undefined ? [] : await read.readChildActions("actions");
    await clickGoBack(ctx);
    return {
        type: "RANDOM",
        actions,
    };
}

export async function readOpenFunction({
    ctx,
    current,
}: ActionReadArgs<ActionFunction>): Promise<Observed<ActionFunction>> {
    const base: Observed<ActionFunction> =
        current ?? { type: "FUNCTION", function: "" };
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("FUNCTION", "function"),
        "function"
    );
    return base;
}

export async function readOpenApplyInventoryLayout({
    ctx,
    current,
}: ActionReadArgs<ActionApplyInventoryLayout>): Promise<Observed<ActionApplyInventoryLayout>> {
    const base: Observed<ActionApplyInventoryLayout> =
        current ?? { type: "APPLY_INVENTORY_LAYOUT", layout: "" };
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("APPLY_INVENTORY_LAYOUT", "layout"),
        "layout"
    );
    return base;
}

export async function readOpenSetMenu({
    ctx,
    current,
}: ActionReadArgs<ActionDisplayMenu>): Promise<Observed<ActionDisplayMenu>> {
    const base: Observed<ActionDisplayMenu> =
        current ?? { type: "SET_MENU", menu: "" };
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("SET_MENU", "menu"),
        "menu"
    );
    return base;
}

export async function readOpenDropItem({
    ctx,
    current,
}: ActionReadArgs<ActionDropItem>): Promise<Observed<ActionDropItem>> {
    const base: Observed<ActionDropItem> =
        current ?? { type: "DROP_ITEM", itemName: "" };
    refreshLocationFromEditor(
        ctx,
        base,
        getActionFieldLabel("DROP_ITEM", "location")
    );
    return base;
}

export async function readOpenPause({
    ctx,
    current,
}: ActionReadArgs<ActionPauseExecution>): Promise<Observed<ActionPauseExecution>> {
    const base: Observed<ActionPauseExecution> =
        current ?? { type: "PAUSE", ticks: 0 };
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("PAUSE", "ticks"),
        "ticks"
    );
    return base;
}

export async function readOpenLaunch({
    ctx,
    current,
}: ActionReadArgs<ActionLaunch>): Promise<Observed<ActionLaunch>> {
    const base: Observed<ActionLaunch> =
        current ?? { type: "LAUNCH", location: { type: "Current Location" }, strength: 0 };
    refreshLocationFromEditor(
        ctx,
        base,
        getActionFieldLabel("LAUNCH", "location")
    );
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("LAUNCH", "strength"),
        "strength"
    );
    return base;
}

export async function readOpenMessage({
    ctx,
    current,
}: ActionReadArgs<ActionSendMessage>): Promise<Observed<ActionSendMessage>> {
    const base: Observed<ActionSendMessage> = current ?? { type: "MESSAGE", message: "" };
    refreshStringFieldFromEditor(
        ctx,
        base,
        getActionFieldLabel("MESSAGE", "message"),
        "message"
    );
    return base;
}

function refreshStringFieldFromEditor(
    ctx: TaskContext,
    base: Observed<Action>,
    fieldLabel: string,
    prop: string
): void {
    const slot = ctx.tryGetItemSlot(fieldLabel);
    if (slot === null) return;
    const value = readStringValue(slot);
    if (value === null) return;
    (base as Record<string, unknown>)[prop] = value;
}

function refreshLocationFromEditor(
    ctx: TaskContext,
    base: Observed<Action>,
    fieldLabel: string
): void {
    const slot = ctx.tryGetItemSlot(fieldLabel);
    if (slot === null) return;
    const value = readStringValue(slot);
    if (value === null) return;
    (base as Record<string, unknown>).location = parseLocationField(value);
    dropNotSetLocationIfOptional(base);
}
