import type { KnowledgeState, KnowledgeStatusRow } from "../knowledge/status";
import { importableIdentity } from "../knowledge/paths";
import { getKnowledgeRows } from "./state";
import type { Importable } from "htsw/types";

export const STATUS_COLOR: { [k in KnowledgeState]: number } = {
    current: 0xff5cb85c | 0,   // green
    modified: 0xffe5bc4b | 0,  // yellow
    unknown: 0xffe85c5c | 0,   // red
};

export const STATUS_LABEL: { [k in KnowledgeState]: string } = {
    current: "current",
    modified: "modified",
    unknown: "unknown",
};

export function statusForImportable(importable: Importable): KnowledgeState {
    const rows = getKnowledgeRows();
    const id = importableIdentity(importable);
    for (let i = 0; i < rows.length; i++) {
        const row: KnowledgeStatusRow = rows[i];
        if (row.identity === id && row.importable.type === importable.type) {
            return row.state;
        }
    }
    return "unknown";
}
