import type { HousingPresence } from "@htsw/importer/importCache/housingPresence";

export function canShowHousingFrame(
    presence: HousingPresence,
    taskRunning: boolean
): boolean {
    return presence === "in" || taskRunning;
}
