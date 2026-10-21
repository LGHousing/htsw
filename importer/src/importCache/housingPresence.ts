export type HousingPresence = "unknown" | "in" | "out";

let housingPresence: HousingPresence = "unknown";

export function getHousingPresence(): HousingPresence {
    return housingPresence;
}

export function reportHousingPresence(verdict: "in" | "out"): void {
    housingPresence = verdict;
}

export function resetHousingPresence(): void {
    housingPresence = "unknown";
}
