import { EVENTS } from "htsw/types";

export function knownEventNames(): string[] {
    return EVENTS.slice();
}

export async function listAllEventNames(): Promise<string[]> {
    return knownEventNames();
}
