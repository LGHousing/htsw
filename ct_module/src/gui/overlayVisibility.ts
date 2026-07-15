export type HousingPresence = "unknown" | "in" | "out";

export function canShowHousingFrame(
    presence: HousingPresence,
    taskRunning: boolean
): boolean {
    return presence === "in" || (presence === "unknown" && taskRunning);
}
