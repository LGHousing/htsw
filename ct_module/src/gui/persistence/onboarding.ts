/// <reference types="../../../CTAutocomplete" />

/**
 * First-run onboarding flags: whether the empty-state "Create sample
 * project" block was dismissed, and whether the click-through tour has been
 * completed (or skipped). `/htsw tour` resets both, putting the GUI back in
 * its fresh-install state.
 */

import { asBoolean, defineDoc, defineValue } from "../../persistence/store";

const ONBOARDING = defineDoc({
    file: "onboarding.json",
    legacyPaths: ["./config/ChatTriggers/modules/HTSW/gui-onboarding.json"],
    onReadError: "defaults",
    pretty: true,
});

const sampleDismissed = defineValue(ONBOARDING, {
    key: "sampleDismissed",
    fallback: false,
    parse: asBoolean,
});
const tourDone = defineValue(ONBOARDING, {
    key: "tourDone",
    fallback: false,
    parse: asBoolean,
});

export function isSampleDismissed(): boolean {
    return sampleDismissed.get();
}

export function setSampleDismissed(): void {
    sampleDismissed.set(true);
}

export function isTourDone(): boolean {
    return tourDone.get();
}

export function setTourDone(): void {
    tourDone.set(true);
}

export function resetOnboarding(): void {
    sampleDismissed.set(false);
    tourDone.set(false);
}
