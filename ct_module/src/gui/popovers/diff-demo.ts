/// <reference types="../../../CTAutocomplete" />

import { getActivePath } from "../state/selection";
import { parseHtslFile } from "../state/htsl-render";
import {
    clearDiff,
    diffKey,
    setCurrent,
    setDiffState,
    type DiffState,
} from "../state/diff";
import {
    setCurrentImportingPath,
    setImportProgress,
} from "../state";

/**
 * Walk through the active .htsl file's actions and publish diff states with a
 * delay so you can watch the right-panel animate without running a real
 * import. Useful while wiring importer instrumentation.
 *
 * Pattern: each action goes "current" → "match" / "edit" / "add" with a
 * cycle so all states get exercised.
 */
export function runDiffDemo(): void {
    const path = getActivePath();
    if (path === null || !path.toLowerCase().endsWith(".htsl")) {
        ChatLib.chat("&c[htsw] open a .htsl tab first");
        return;
    }
    const parsed = parseHtslFile(path);
    if (parsed.parseError !== null) {
        ChatLib.chat(`&c[htsw] parse failed: ${parsed.parseError}`);
        return;
    }
    const key = diffKey(path);
    clearDiff(key);
    const cycle: DiffState[] = ["match", "edit", "add", "match"];
    const total = parsed.actions.length;
    if (total === 0) {
        ChatLib.chat("&c[htsw] empty action list");
        return;
    }
    ChatLib.chat(`&a[htsw] diff demo: ${total} actions on ${path}`);
    // Light up the right panel's Import tab too — its inline live-importer
    // strip reads getImportProgress(), so the demo animates there alongside
    // the right-panel source preview.
    setCurrentImportingPath(path);
    setImportProgress({
        weightCompleted: 0,
        weightTotal: total,
        weightCurrent: 0,
        currentKey: "",
        currentType: null,
        currentIdentity: "diff demo",
        orderIndex: -1,
        rowStatus: null,
        currentLabel: "diff demo",
        phase: "applying",
        phaseLabel: "diff demo",
        unitCompleted: 0,
        unitTotal: total,
        estimatedCompleted: 0,
        estimatedTotal: total,
        etaConfidence: "planned",
        phaseBudget: null,
        weights: [],
        completed: 0,
        total: 1,
        failed: 0,
        inFlight: true,
    });
    let i = 0;
    const tick = () => {
        if (i >= total) {
            setCurrent(key, null);
            setCurrentImportingPath(null);
            setImportProgress(null);
            ChatLib.chat("&a[htsw] diff demo done");
            return;
        }
        const finalState = cycle[i % cycle.length];
        setCurrent(key, String(i), `step ${i + 1}/${total} (→ ${finalState})`);
        setImportProgress({
            weightCompleted: i,
            weightTotal: total,
            weightCurrent: 1,
            currentKey: "",
            currentType: null,
            currentIdentity: "diff demo",
            orderIndex: -1,
            rowStatus: null,
            currentLabel: `diff demo · ${i + 1}/${total}`,
            phase: "applying",
            phaseLabel: "diff demo",
            unitCompleted: i,
            unitTotal: total,
            estimatedCompleted: i,
            estimatedTotal: total,
            etaConfidence: "planned",
            phaseBudget: null,
            weights: [],
            completed: 0,
            total: 1,
            failed: 0,
            inFlight: true,
        });
        // Settle this action after a short pause, then advance.
        setTimeout(() => {
            setDiffState(key, String(i), finalState);
            i++;
            setTimeout(tick, 250);
        }, 250);
    };
    tick();
}
