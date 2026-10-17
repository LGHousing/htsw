import type { Importable, Pos } from "htsw/types";
import { npcPosIdentity } from "htsw-editor-common/project";

export function parseNpcPosIdentity(identity: string): Pos {
    const parts = identity.split(",");
    return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) };
}

export function importableIdentity(importable: Importable): string {
    if (importable.type === "EVENT") return importable.event;
    if (importable.type === "NPC") return npcPosIdentity(importable.pos);
    return importable.name;
}

export function importableKey(type: Importable["type"], identity: string): string {
    return `${type}:${identity}`;
}
