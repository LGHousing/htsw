/// <reference types="../../../CTAutocomplete" />

import { Element, Rect } from "../lib/layout";
import { Button, Col, Input, Row, Text } from "../lib/components";
import { closeAllPopovers, openPopover } from "../lib/popovers";
import { getAlias, setAlias, clearAlias } from "../../knowledge/aliases";

let editingUuid: string | null = null;
let editingValue = "";

function shortUuid(uuid: string): string {
    if (uuid.length <= 18) return uuid;
    return `${uuid.substring(0, 8)}…${uuid.substring(uuid.length - 6)}`;
}

function syncFromUuid(uuid: string): void {
    if (editingUuid !== uuid) {
        editingUuid = uuid;
        editingValue = getAlias(uuid) ?? "";
    }
}

function save(uuid: string): void {
    const trimmed = editingValue.trim();
    if (trimmed.length === 0) {
        clearAlias(uuid);
        ChatLib.chat(`&7[htsw] Cleared alias for ${shortUuid(uuid)}`);
    } else {
        setAlias(uuid, trimmed);
        ChatLib.chat(`&a[htsw] Aliased ${shortUuid(uuid)} → ${trimmed}`);
    }
    editingUuid = null;
    editingValue = "";
    closeAllPopovers();
}

function clear(uuid: string): void {
    clearAlias(uuid);
    ChatLib.chat(`&7[htsw] Cleared alias for ${shortUuid(uuid)}`);
    editingUuid = null;
    editingValue = "";
    closeAllPopovers();
}

function popoverContent(uuid: string): Element {
    syncFromUuid(uuid);
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({
                text: `Alias for ${shortUuid(uuid)}`,
                style: { width: { kind: "grow" } },
            }),
            Input({
                id: "alias-input",
                value: () => editingValue,
                onChange: (v) => {
                    editingValue = v;
                },
                onSubmit: () => save(uuid),
                placeholder: "nickname…",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 18 },
                },
            }),
            // Explicit width: grow + height so Save/Clear fill the popover
            // width and match the input height instead of collapsing to a
            // thin 8px text-height strip.
            Row({
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 18 },
                    gap: 4,
                },
                children: [
                    Button({
                        text: "Save",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "px", value: 18 },
                        },
                        onClick: () => save(uuid),
                    }),
                    Button({
                        text: "Clear",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "px", value: 18 },
                        },
                        onClick: () => clear(uuid),
                    }),
                ],
            }),
        ],
    });
}

export function openAliasPopover(anchor: Rect, uuid: string): void {
    syncFromUuid(uuid);
    openPopover({
        anchor,
        content: popoverContent(uuid),
        width: 220,
        // 6 (top pad) + 8 (title) + 4 (gap) + 18 (input) + 4 (gap) + 18
        // (buttons) + 6 (bottom pad) = 64
        height: 64,
        key: `alias:${uuid}`,
    });
}
