import { pruneTypeOf } from "./registry";
import {
    ownedTargets,
    unownedTargets,
    type PrunePlan,
    type PruneTarget,
} from "./types";

const MAX_LISTED_PER_GROUP = 20;

/** "3 functions, 1 menu" — plural-correct, in scan order. */
export function summarizeTargets(targets: readonly PruneTarget[]): string {
    const counts = new Map<PruneTarget["type"], number>();
    for (const target of targets) {
        counts.set(target.type, (counts.get(target.type) ?? 0) + 1);
    }
    const parts: string[] = [];
    for (const [type, count] of counts) {
        const spec = pruneTypeOf(type);
        parts.push(`${count} ${count === 1 ? spec.label : spec.pluralLabel}`);
    }
    return parts.join(", ");
}

export function describeTarget(target: PruneTarget): string {
    const spec = pruneTypeOf(target.type);
    const verb = target.method === "clearActions" ? "clear actions of" : "delete";
    return `${verb} ${spec.label} "${target.label}"`;
}

/**
 * The plan as chat lines. Owned and unowned targets list separately: taking back
 * a previous import's work is a different decision from removing something htsw
 * has no record of making.
 */
export function formatPrunePlan(plan: PrunePlan, manifest: string): string[] {
    const owned = ownedTargets(plan);
    const unowned = unownedTargets(plan);
    const lines: string[] = [
        `&7[htsw] Prune plan · ${manifest}`,
        `&7[htsw] ${plan.targets.length} to remove ` +
            `(${owned.length} previously imported, ${unowned.length} not made by htsw)`,
    ];

    appendGroup(
        lines,
        owned,
        "&e[htsw] Imported by this project before:"
    );
    appendGroup(
        lines,
        unowned,
        "&c[htsw] Not made by htsw — can't be undone:"
    );

    if (plan.unsupported.length > 0) {
        lines.push(
            `&6[htsw] ${summarizeTargets(plan.unsupported)} aren't declared, ` +
                "but htsw can't remove them yet:"
        );
        appendIdentities(lines, plan.unsupported);
    }

    for (const failure of plan.scanFailures) {
        lines.push(
            `&c[htsw] Couldn't scan ${failure.type.toLowerCase()}s, so this plan is ` +
                `incomplete: ${failure.reason}`
        );
    }

    if (plan.targets.length === 0 && plan.unsupported.length === 0) {
        lines.push("&a[htsw] Nothing in this house is missing from the manifest.");
    }
    return lines;
}

function appendGroup(
    lines: string[],
    targets: readonly PruneTarget[],
    heading: string
): void {
    if (targets.length === 0) return;
    lines.push(heading);
    appendIdentities(lines, targets);
}

function appendIdentities(lines: string[], targets: readonly PruneTarget[]): void {
    const shown = Math.min(targets.length, MAX_LISTED_PER_GROUP);
    for (let i = 0; i < shown; i++) {
        lines.push(`&7[htsw]   ${describeTarget(targets[i])}`);
    }
    if (targets.length > shown) {
        lines.push(`&7[htsw]   …and ${targets.length - shown} more`);
    }
}

/** Plan lines for a popover, which has its own heading and no chat prefixes. */
export function prunePlanPopoverLines(plan: PrunePlan): string[] {
    const lines: string[] = [];
    const owned = ownedTargets(plan);
    const unowned = unownedTargets(plan);
    if (owned.length > 0) {
        lines.push(`Previously imported by this project (${owned.length}):`);
        for (const target of owned.slice(0, MAX_LISTED_PER_GROUP)) {
            lines.push(`  ${describeTarget(target)}`);
        }
        if (owned.length > MAX_LISTED_PER_GROUP) {
            lines.push(`  …and ${owned.length - MAX_LISTED_PER_GROUP} more`);
        }
    }
    if (unowned.length > 0) {
        lines.push(`NOT made by htsw (${unowned.length}) — unrecoverable:`);
        for (const target of unowned.slice(0, MAX_LISTED_PER_GROUP)) {
            lines.push(`  ${describeTarget(target)}`);
        }
        if (unowned.length > MAX_LISTED_PER_GROUP) {
            lines.push(`  …and ${unowned.length - MAX_LISTED_PER_GROUP} more`);
        }
    }
    if (plan.unsupported.length > 0) {
        lines.push(`Undeclared but not removable: ${summarizeTargets(plan.unsupported)}`);
    }
    for (const failure of plan.scanFailures) {
        lines.push(`Scan of ${failure.type.toLowerCase()}s failed — plan is incomplete`);
    }
    lines.push("Housing has no undo.");
    return lines;
}
