import type { HousingPresence } from "../importCache/housingPresence";

export function canShowHousingFrame(
    presence: HousingPresence,
    taskRunning: boolean
): boolean {
    return presence === "in" || taskRunning;
}
