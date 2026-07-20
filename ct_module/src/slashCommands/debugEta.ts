import { getTimingStats } from "../housingSync/progress/timing";
import { COST } from "../housingSync/progress/costs";

export function printOpKindStats(): void {
    const stats = getTimingStats();
    const kinds: string[] = [
        "commandMenuWait",
        "commandMessageWait",
        "menuClickWait",
        "messageClickWait",
        "pageTurnWait",
        "goBackWait",
        "chatInput",
        "anvilInput",
        "itemSelect",
        "reorderStep",
        "sleep1000",
    ];
    ChatLib.chat("&7[eta] per-op-kind units / ms/unit");
    let printed = false;
    for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[i];
        const entry = stats[kind];
        if (entry === undefined || entry.count === 0) continue;
        printed = true;
        const units = costForKind(kind);
        const current = entry.avgMsPerExpectedUnit;
        const baseline = entry.baselineMsPerExpectedUnit;
        const delta = current - baseline;
        const pct = baseline > 0 ? (delta / baseline) * 100 : 0;
        let trend: string;
        if (Math.abs(pct) < 3) trend = "&7~";
        else if (pct > 0) trend = `&c↑${pct.toFixed(0)}%`;
        else trend = `&a↓${Math.abs(pct).toFixed(0)}%`;
        const unitsStr = units !== null ? `&f${units.toFixed(2)}u/op` : "&7(no cost)";
        ChatLib.chat(
            `&7  ${kind}: ${unitsStr} &7| &f${entry.count}&7 samples => &f${current.toFixed(0)}ms/u &7(baseline &f${baseline.toFixed(0)}&7 ${trend}&7)`
        );
    }
    if (!printed) {
        ChatLib.chat("&7  (no samples yet)");
    }
}

function costForKind(kind: string): number | null {
    if (kind === "sleep1000") return COST.guaranteedSleep1000;
    const v = (COST as Record<string, number>)[kind];
    return typeof v === "number" ? v : null;
}

export function dumpEtaToFile(): void {
    const stats = getTimingStats();
    const dump = {
        capturedAt: new Date().toISOString(),
        perOpKind: stats,
    };
    const path = `./htsw/eta-${Date.now()}.json`;
    try {
        FileLib.write(path, JSON.stringify(dump, null, 2), true);
        ChatLib.chat(`&a[eta] wrote ${path}`);
    } catch (e) {
        ChatLib.chat(`&c[eta] failed to write ${path}: ${String(e)}`);
    }
}
