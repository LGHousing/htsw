import TaskContext from "../tasks/context";
import { getAutoProceedSetting, setAutoProceedSetting } from "../settings";

let auto = true;
let pendingAdvance = false;

export function getStepAuto(): boolean {
    return auto;
}

export function setStepAuto(value: boolean): void {
    auto = value;
    if (auto) {
        pendingAdvance = false;
    }
}

// The persisted "Auto-proceed imports" preference behind the Settings toggle.
// Separate from the live `auto` gate above: Pause/Resume during a run flips
// only `auto`, while this is the default that resetStepGate restores at the
// start of each import. Writing it also updates the live gate so toggling the
// setting takes effect on an in-flight import too.
export function getAutoProceedPreference(): boolean {
    return getAutoProceedSetting();
}

export function setAutoProceedPreference(value: boolean): void {
    setAutoProceedSetting(value);
    setStepAuto(value);
}

export function requestStepAdvance(): void {
    pendingAdvance = true;
}

export async function waitIfStepPaused(ctx: TaskContext): Promise<void> {
    if (auto) return;
    while (!auto && !pendingAdvance) {
        await ctx.sleep(50);
    }
    pendingAdvance = false;
}

export function resetStepGate(): void {
    auto = getAutoProceedSetting();
    pendingAdvance = false;
}
