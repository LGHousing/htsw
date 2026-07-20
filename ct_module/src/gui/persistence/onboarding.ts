/// <reference types="../../../CTAutocomplete" />

/**
 * First-run onboarding flags: whether the empty-state "Create sample
 * project" block was dismissed, and whether the click-through tour has been
 * completed (or skipped). `/htsw tour` resets both, putting the GUI back in
 * its fresh-install state.
 */

import { runtimeString, type RuntimeString } from "../lib/java";

const ONBOARDING_PATH = "./config/ChatTriggers/modules/HTSW/gui-onboarding.json";

type OnboardingState = {
    sampleDismissed: boolean;
    tourDone: boolean;
};

let state: OnboardingState = { sampleDismissed: false, tourDone: false };
let loaded = false;

function load(): void {
    if (loaded) return;
    loaded = true;
    try {
        if (!FileLib.exists(ONBOARDING_PATH)) return;
        const stored = FileLib.read(ONBOARDING_PATH) as RuntimeString | null | undefined;
        const raw = runtimeString(stored);
        if (raw.trim() === "") return;
        const parsed = JSON.parse(raw) as Partial<OnboardingState>;
        state = {
            sampleDismissed: parsed.sampleDismissed === true,
            tourDone: parsed.tourDone === true,
        };
    } catch (_e) {
        // fresh state on a bad file
    }
}

function persist(): void {
    try {
        FileLib.write(ONBOARDING_PATH, JSON.stringify(state, null, 2), true);
    } catch (_e) {
        // best-effort
    }
}

export function isSampleDismissed(): boolean {
    load();
    return state.sampleDismissed;
}

export function setSampleDismissed(): void {
    load();
    state.sampleDismissed = true;
    persist();
}

export function isTourDone(): boolean {
    load();
    return state.tourDone;
}

export function setTourDone(): void {
    load();
    state.tourDone = true;
    persist();
}

export function resetOnboarding(): void {
    load();
    state = { sampleDismissed: false, tourDone: false };
    persist();
}
