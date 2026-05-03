/// <reference types="../../CTAutocomplete" />

import { getActivePath } from "./selection";
import { parseHtslFile } from "./htsl-render";
import {
    clearDiff,
    diffKey,
    setCurrent,
    setDiffState,
    type DiffState,
} from "./diff-state";

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
    let i = 0;
    const tick = () => {
        if (i >= total) {
            setCurrent(key, null);
            ChatLib.chat("&a[htsw] diff demo done");
            return;
        }
        const finalState = cycle[i % cycle.length];
        setCurrent(key, i, `step ${i + 1}/${total} (→ ${finalState})`);
        // Settle this action after a short pause, then advance.
        setTimeout(() => {
            setDiffState(key, i, finalState);
            i++;
            setTimeout(tick, 250);
        }, 250);
    };
    tick();
}
