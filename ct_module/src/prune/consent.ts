import {
    asStringSetValue,
    defineRootDoc,
    serializeStringSet,
} from "../persistence/store";

/**
 * Projects that have confirmed, once, what an armed manifest would delete from a
 * specific house. `dangerouslyDeleteEverythingNotInThisFile` lives in the file
 * and so arrives with a clone or someone else's commit; acting on it unprompted
 * would let a pull destroy a house nobody had looked at.
 *
 * Keyed by manifest AND house, so rebinding the project asks again. Default
 * `refuse` read policy: an unparseable document reads as "not consented" rather
 * than granting it.
 */
const consentedProjects = defineRootDoc<Set<string>>({
    file: "prune-consent.json",
    fallback: new Set<string>(),
    parse: asStringSetValue,
    serialize: serializeStringSet,
});

function consentKey(manifestPath: string, housingUuid: string): string {
    return `${manifestPath}|${housingUuid}`;
}

export function hasPruneConsent(manifestPath: string, housingUuid: string): boolean {
    if (!consentedProjects.healthy()) return false;
    return consentedProjects.get().has(consentKey(manifestPath, housingUuid));
}

export function grantPruneConsent(manifestPath: string, housingUuid: string): boolean {
    if (!consentedProjects.healthy()) return false;
    const current = consentedProjects.get();
    const key = consentKey(manifestPath, housingUuid);
    if (current.has(key)) return true;
    const next = new Set<string>(current);
    next.add(key);
    return consentedProjects.set(next);
}

export function revokePruneConsent(manifestPath: string, housingUuid: string): boolean {
    if (!consentedProjects.healthy()) return false;
    const current = consentedProjects.get();
    const key = consentKey(manifestPath, housingUuid);
    if (!current.has(key)) return true;
    const next = new Set<string>(current);
    next.delete(key);
    return consentedProjects.set(next);
}
