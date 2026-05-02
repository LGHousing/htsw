/// <reference types="../../CTAutocomplete" />

// Per-input GuiTextField management. We delegate cursor/selection/clipboard/arrow-key handling
// to vanilla MC's GuiTextField rather than reimplementing it. Each input id keeps one field
// instance; we recreate it only when the laid-out width/height changes (those are final on the
// vanilla field).
//
// Obfuscated names — CT 1.8.9 uses SRG/obf for member access (same convention as bounds.ts /
// scissor.ts). Method/field maps are documented inline.

// @ts-ignore
const GuiTextFieldClass = Java.type("net.minecraft.client.gui.GuiTextField");

type Record = {
    field: any;       // GuiTextField
    w: number;
    h: number;
    lastSyncedText: string;
};

const records: { [id: string]: Record } = {};
let nextComponentId = 1000;

function newField(x: number, y: number, w: number, h: number, text: string): any {
    const fr = Renderer.getFontRenderer();
    // GuiTextField(int componentId, FontRenderer, int x, int y, int width, int height)
    const f = new GuiTextFieldClass(nextComponentId++, fr, x, y, w, h);
    f.func_146203_f(256);             // setMaxStringLength
    f.func_146185_a(false);           // setEnableBackgroundDrawing(false) — we draw our own bg
    f.func_146205_d(false);           // setCanLoseFocus(false) — focus controlled externally
    f.func_146180_a(text);            // setText
    return f;
}

export function getInputField(
    id: string,
    x: number, y: number, w: number, h: number,
    propText: string,
): any {
    let r = records[id];
    if (!r || r.w !== w || r.h !== h) {
        const oldText = r ? r.field.func_146179_b() : propText;
        const oldCursor = r ? r.field.func_146198_h() : propText.length; // getCursorPosition
        const newF = newField(x, y, w, h, oldText);
        newF.func_146190_e(oldCursor); // setCursorPosition
        r = { field: newF, w, h, lastSyncedText: oldText };
        records[id] = r;
    }
    // Reposition each frame (xPosition/yPosition are mutable on GuiTextField).
    r.field.field_146209_f = x;
    r.field.field_146210_g = y;
    // If the prop changed externally (not via editing), push it into the field.
    if (propText !== r.lastSyncedText && propText !== r.field.func_146179_b()) {
        r.field.func_146180_a(propText);
        r.lastSyncedText = propText;
    }
    return r.field;
}

// Returns the field's current text and updates the synced-from-prop snapshot. Use after
// editing to detect onChange-worthy edits.
export function readAndSync(id: string): string | null {
    const r = records[id];
    if (!r) return null;
    const t = r.field.func_146179_b();
    r.lastSyncedText = t;
    return t;
}

export function getRecord(id: string): Record | null {
    return records[id] ?? null;
}

export function dropInputField(id: string): void {
    delete records[id];
}

export function tickAllFields(): void {
    for (const id in records) records[id].field.func_146178_a(); // updateCursorCounter
}

export function applyFocus(focusedId: string | null): void {
    for (const id in records) {
        const focused = id === focusedId;
        records[id].field.func_146195_b(focused); // setFocused
    }
}
