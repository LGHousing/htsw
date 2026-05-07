import type {
    Action,
    ActionChangeVar,
    ActionPlaySound,
    ActionSendMessage,
} from "htsw/types";

import type { ObservedActionSlot } from "../src/importer/types";

// `index` is set explicitly because ObservedActionSlot tracks slot identity
// (slotId, slot ref) — it isn't just the position in an array. Desired uses
// a plain Action[] where array position IS the desired index.
export function observedSlot(
    index: number,
    action: NonNullable<ObservedActionSlot["action"]>
): ObservedActionSlot {
    return { index, slotId: index, slot: null as never, action };
}

// Action builders take a partial override plus an optional `note` (which
// lives on the Action union, not on the per-variant types — see
// language/src/types/actions.ts:294).
type ActionOverride<T extends Action> = Partial<Omit<T, "type">> & { note?: string };

export const playSound = (over: ActionOverride<ActionPlaySound> = {}): ActionPlaySound => ({
    type: "PLAY_SOUND",
    sound: "random.anvil_land",
    ...(over as Partial<ActionPlaySound>),
});

export const message = (
    text: string,
    over: ActionOverride<ActionSendMessage> = {}
): ActionSendMessage => ({
    type: "MESSAGE",
    message: text,
    ...(over as Partial<ActionSendMessage>),
});

export const changeVar = (
    over: ActionOverride<ActionChangeVar> = {}
): ActionChangeVar => ({
    type: "CHANGE_VAR",
    holder: { type: "Player" },
    key: "k",
    op: "Set",
    value: "0",
    ...(over as Partial<ActionChangeVar>),
});
