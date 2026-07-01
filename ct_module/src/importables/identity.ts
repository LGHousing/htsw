import type { Importable } from "htsw/types";

export function importableIdentity(importable: Importable): string {
    if (importable.type === "EVENT") return importable.event;
    if (importable.type === "NPC") {
        return `${importable.pos.x},${importable.pos.y},${importable.pos.z}`;
    }
    return importable.name;
}

export function importableKey(type: Importable["type"], identity: string): string {
    return `${type}:${identity}`;
}
