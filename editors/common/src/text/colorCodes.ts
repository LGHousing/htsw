// Delegates to the language package — the ONE implementation of formatting-
// code handling, shared with ct_module. Keep these thin re-exports so
// existing imports stay stable.
import { helpers } from "htsw";

export function ampToSection(value: string): string {
    return helpers.ampToSection(value);
}

export function sectionToAmp(value: string): string {
    return helpers.sectionToAmp(value);
}

export function stripFormatting(value: string): string {
    return helpers.stripFormatting(value);
}
