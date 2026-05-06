/// <reference types="../../../CTAutocomplete" />

import { Element, Rect } from "../lib/layout";
import { Button, Col, Input, Row, Text } from "../lib/components";
import { closeAllPopovers, openPopover } from "../lib/popovers";
import { getHousingUuid } from "../state";
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
                placeholder: "nickname…",
                style: { width: { kind: "grow" } },
            }),
            Row({
                style: { gap: 4 },
                children: [
                    Button({
                        text: "Save",
                        style: { width: { kind: "grow" } },
                        onClick: () => save(uuid),
                    }),
                    Button({
                        text: "Clear",
                        style: { width: { kind: "grow" } },
                        onClick: () => clear(uuid),
                    }),
                ],
            }),
        ],
    });
}

export function openAliasPopover(anchor: Rect): void {
    const uuid = getHousingUuid();
    if (uuid === null) {
        ChatLib.chat("&c[htsw] No housing UUID detected — run /wtfmap first");
        return;
    }
    syncFromUuid(uuid);
    openPopover({
        anchor,
        content: popoverContent(uuid),
        width: 220,
        height: 80,
        key: "alias",
    });
}
