/// <reference types="../../CTAutocomplete" />

import TaskContext from "../tasks/context";
import { removedFormatting } from "../utils/helpers";
import { listAllMenuNames } from "../importables/menus/listMenus";

// Empirically measures the slash-command cooldown Hypixel enforces — the thing
// `TaskContext.COMMAND_COOLDOWN_MS` (a padded 1200ms guess) is meant to clear.
//
// Modes. All three command pairs came back clean down to ~200ms; the open
// question is the instant (same-tick) region, where the importer's real
// back-to-back commands live and the original stall was reported.
//   edit    — `/menu edit <missing>` → `/menu edit <missing>`. Read-only.
//   create  — `/menu edit <missing>` → `/menu create <name>`. The documented
//             stall sequence.
//   mutate  — `/menu create A` → `/menu create B`. Two mutations back-to-back.
//             Reuses two names (deleted with clearance between trials) so it
//             never approaches Housing's 40-menu cap, which a unique-name-per-
//             trial scheme blew straight through.
//   cleanup — delete every `__htsw_*` probe menu left in the house.
//
// Sends go through `ChatLib.say` directly, NOT `ctx.runCommand`: runCommand
// applies the very cooldown spacing we're trying to observe.

const MISSING_MENU = "__htsw_missing__";
const PROBE_MENU = "__htsw_probe_menu__";
const HTSW_MENU_PREFIX = "__htsw_";
const MUTATE_MENU_A = "__htsw_m_a__";
const MUTATE_MENU_B = "__htsw_m_b__";
const EDIT_MISSING_COMMAND = `/menu edit ${MISSING_MENU}`;

const NOT_FOUND_REPLY = "Could not find a custom menu with that title!";
const CREATED_REPLY = "Created custom menu";
const COOLDOWN_MARKER = "on cooldown";

const REPLY_TIMEOUT_MS = 3000;
// Rest long enough before each measured pair that the cooldown is definitely
// clear, so the pair's first send is always accepted and only the second tests Δ.
const REST_BETWEEN_TRIALS_MS = 2500;
// Spacing after a mutating command (create/delete) so the next one isn't
// throttled — comfortably above the observed cooldown (creates are clean by
// ~1s). Keeps the mutate-mode prep deletes and cleanup deletes from being eaten.
const MUTATE_CLEAR_MS = 1500;
const SAMPLES_PER_INTERVAL = 3;
// Everything >=200ms came back clean across edit/create/mutate, so this sweep
// targets the unprobed instant region: Δ=0 fires both sends in the same tick
// (ctx.sleep(0) returns before awaiting a tick), reproducing the importer's
// real back-to-back command pattern. 50/100/150 land tick-quantized between.
const INTERVALS_MS = [200, 150, 100, 50, 0];

export type CooldownProbeMode = "edit" | "create" | "mutate" | "cleanup";

type TrialOutcome = "accepted" | "cooled" | "timeout" | "invalid";

type IntervalRow = {
    requested: number;
    accepted: number;
    cooled: number;
    timeout: number;
    invalid: number;
    observedDeltas: number[];
};

function stripped(message: string): string {
    return removedFormatting(message);
}

function isCooldown(message: string): boolean {
    return stripped(message).indexOf(COOLDOWN_MARKER) >= 0;
}

function isNotFound(message: string): boolean {
    return stripped(message).indexOf(NOT_FOUND_REPLY) >= 0;
}

function isCreated(message: string): boolean {
    return stripped(message).indexOf(CREATED_REPLY) >= 0;
}

const notFoundOrCooldown = (m: string): boolean => isNotFound(m) || isCooldown(m);
const createdOrCooldown = (m: string): boolean => isCreated(m) || isCooldown(m);

async function awaitReply(
    ctx: TaskContext,
    waiter: Promise<[string]>,
    reason: string
): Promise<string | null> {
    try {
        const result = await ctx.withTimeout(waiter, reason, REPLY_TIMEOUT_MS);
        return result[0];
    } catch (_e) {
        return null;
    }
}

// Fire two commands deltaMs apart and classify the SECOND reply. Assumes the
// cooldown is already clear (caller rests first). Registers the first reply
// waiter before send #1 and the second before send #2, so replies map to sends
// by arrival order even when Δ is shorter than the round-trip.
async function measurePair(
    ctx: TaskContext,
    firstCommand: string,
    secondCommand: string,
    firstReply: (m: string) => boolean,
    secondReply: (m: string) => boolean,
    deltaMs: number
): Promise<{ outcome: TrialOutcome; observedDelta: number }> {
    const firstWaiter = ctx.waitFor("message", firstReply);
    const t1 = Date.now();
    ChatLib.say(firstCommand);

    await ctx.sleep(deltaMs);

    const secondWaiter = ctx.waitFor("message", secondReply);
    const t2 = Date.now();
    ChatLib.say(secondCommand);

    const observedDelta = t2 - t1;
    const first = await awaitReply(ctx, firstWaiter, "cooldown probe reply 1");
    const second = await awaitReply(ctx, secondWaiter, "cooldown probe reply 2");

    if (first === null || second === null) return { outcome: "timeout", observedDelta };
    if (isCooldown(first)) return { outcome: "invalid", observedDelta };
    return { outcome: isCooldown(second) ? "cooled" : "accepted", observedDelta };
}

function emptyRow(requested: number): IntervalRow {
    return { requested, accepted: 0, cooled: 0, timeout: 0, invalid: 0, observedDeltas: [] };
}

function record(row: IntervalRow, outcome: TrialOutcome, observedDelta: number): void {
    row.observedDeltas.push(observedDelta);
    row[outcome]++;
}

function logRow(ctx: TaskContext, row: IntervalRow): void {
    ctx.displayMessage(
        `&7[cooldownprobe] Δ=${row.requested}ms → &a${row.accepted} ok &c${row.cooled} cooled` +
        (row.timeout > 0 ? ` &8${row.timeout} timeout` : "") +
        (row.invalid > 0 ? ` &8${row.invalid} invalid` : "")
    );
}

async function runEditTrials(ctx: TaskContext, rows: IntervalRow[]): Promise<void> {
    for (let i = 0; i < INTERVALS_MS.length; i++) {
        const row = emptyRow(INTERVALS_MS[i]);
        for (let s = 0; s < SAMPLES_PER_INTERVAL; s++) {
            await ctx.sleep(REST_BETWEEN_TRIALS_MS);
            const r = await measurePair(
                ctx, EDIT_MISSING_COMMAND, EDIT_MISSING_COMMAND,
                notFoundOrCooldown, notFoundOrCooldown, row.requested
            );
            record(row, r.outcome, r.observedDelta);
        }
        rows.push(row);
        logRow(ctx, row);
    }
}

async function runCreateTrials(ctx: TaskContext, rows: IntervalRow[]): Promise<void> {
    const createProbe = `/menu create ${PROBE_MENU}`;
    const deleteProbe = `/menu delete ${PROBE_MENU}`;
    for (let i = 0; i < INTERVALS_MS.length; i++) {
        const row = emptyRow(INTERVALS_MS[i]);
        for (let s = 0; s < SAMPLES_PER_INTERVAL; s++) {
            await ctx.sleep(REST_BETWEEN_TRIALS_MS);
            const r = await measurePair(
                ctx, EDIT_MISSING_COMMAND, createProbe,
                notFoundOrCooldown, createdOrCooldown, row.requested
            );
            record(row, r.outcome, r.observedDelta);
            // Only an accepted create made a menu; delete it with clearance so
            // the next trial's create is fresh and nothing is left behind.
            if (r.outcome === "accepted") {
                await ctx.sleep(REST_BETWEEN_TRIALS_MS);
                ChatLib.say(deleteProbe);
            }
        }
        rows.push(row);
        logRow(ctx, row);
    }
}

// Delete a menu, then wait out the mutation cooldown so the NEXT mutating
// command isn't throttled. Fire-and-forget on the reply: the delete's success
// wording is unconfirmed, so we rely only on the spacing landing it.
async function clearMenu(ctx: TaskContext, name: string): Promise<void> {
    ChatLib.say(`/menu delete ${name}`);
    await ctx.sleep(MUTATE_CLEAR_MS);
}

async function runMutateTrials(ctx: TaskContext, rows: IntervalRow[]): Promise<void> {
    for (let i = 0; i < INTERVALS_MS.length; i++) {
        const row = emptyRow(INTERVALS_MS[i]);
        for (let s = 0; s < SAMPLES_PER_INTERVAL; s++) {
            // Reuse two names, deleted fresh each trial with clearance so both
            // creates land as real "Created …" replies — keeps at most two
            // probe menus alive at once, far under the 40-menu cap. The lead
            // clear also spaces us off the previous trial's create.
            await ctx.sleep(MUTATE_CLEAR_MS);
            await clearMenu(ctx, MUTATE_MENU_A);
            await clearMenu(ctx, MUTATE_MENU_B);
            const r = await measurePair(
                ctx, `/menu create ${MUTATE_MENU_A}`, `/menu create ${MUTATE_MENU_B}`,
                createdOrCooldown, createdOrCooldown, row.requested
            );
            record(row, r.outcome, r.observedDelta);
        }
        rows.push(row);
        logRow(ctx, row);
    }
    await clearMenu(ctx, MUTATE_MENU_A);
    await clearMenu(ctx, MUTATE_MENU_B);
}

async function runCleanupMode(ctx: TaskContext): Promise<void> {
    ctx.displayMessage("&e[cooldownprobe] cleanup — reading your menu list…");
    let names: string[];
    try {
        names = await listAllMenuNames(ctx);
    } catch (e) {
        ctx.displayMessage(`&c[cooldownprobe] couldn't read the menu list: ${e}`);
        return;
    }
    const mine = names.filter((n) => n.indexOf(HTSW_MENU_PREFIX) === 0);
    if (mine.length === 0) {
        ctx.displayMessage("&a[cooldownprobe] no probe menus found — nothing to clean.");
        return;
    }
    ctx.displayMessage(`&7[cooldownprobe] deleting ${mine.length} probe menus…`);
    for (let i = 0; i < mine.length; i++) {
        await clearMenu(ctx, mine[i]);
    }
    ctx.displayMessage(`&a[cooldownprobe] deleted ${mine.length} probe menus.`);
}

async function preflight(ctx: TaskContext): Promise<boolean> {
    const waiter = ctx.waitFor("message", notFoundOrCooldown);
    ChatLib.say(EDIT_MISSING_COMMAND);
    const reply = await awaitReply(ctx, waiter, "cooldown probe preflight");
    return reply !== null && !isCooldown(reply);
}

function avg(values: number[]): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i];
    return Math.round(sum / values.length);
}

function pad(value: number, width: number): string {
    let s = String(value);
    while (s.length < width) s += " ";
    return s;
}

function buildReport(modeName: CooldownProbeMode, sequence: string, rows: IntervalRow[]): string[] {
    const lines: string[] = [];
    lines.push(`HTSW command-cooldown probe (${modeName} mode) — ${new Date().toISOString()}`);
    lines.push(`sequence: ${sequence}`);
    lines.push(`samples/interval: ${SAMPLES_PER_INTERVAL}, rest between trials: ${REST_BETWEEN_TRIALS_MS}ms`);
    lines.push("");
    lines.push("reqΔ(ms)  obsΔavg(ms)  accepted  cooled  timeout  invalid");
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        lines.push(
            `${pad(r.requested, 8)}  ${pad(avg(r.observedDeltas), 10)}  ` +
            `${pad(r.accepted, 8)}  ${pad(r.cooled, 6)}  ${pad(r.timeout, 7)}  ${pad(r.invalid, 7)}`
        );
    }
    lines.push("");

    let smallestSafe: IntervalRow | null = null;
    let largestCooled: IntervalRow | null = null;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.timeout === 0 && r.invalid === 0 && r.cooled === 0 && r.accepted > 0) {
            if (smallestSafe === null || r.requested < smallestSafe.requested) smallestSafe = r;
        }
        if (r.cooled > 0 && (largestCooled === null || r.requested > largestCooled.requested)) {
            largestCooled = r;
        }
    }

    if (smallestSafe === null) {
        lines.push("Every tested interval got throttled at least once — the real cooldown is");
        lines.push("above the max tested interval. Re-run with larger INTERVALS_MS.");
    } else if (largestCooled === null) {
        const min = INTERVALS_MS[INTERVALS_MS.length - 1];
        if (min <= 0) {
            lines.push("Nothing throttled — even instant (same-tick) back-to-back sends go through.");
        } else {
            lines.push(`No interval was throttled — the cooldown for this sequence is below ${min}ms.`);
        }
    } else {
        lines.push(
            `Threshold sits between ${largestCooled.requested}ms (throttled, obs avg ` +
            `${avg(largestCooled.observedDeltas)}ms) and ${smallestSafe.requested}ms (clean, ` +
            `obs avg ${avg(smallestSafe.observedDeltas)}ms).`
        );
        lines.push(
            `Suggested spacing before a mutating command ≈ ${avg(smallestSafe.observedDeltas) + 100} ` +
            `(smallest clean observed interval + 100ms round-trip margin). Current COMMAND_COOLDOWN_MS is 1200.`
        );
    }
    return lines;
}

const SEQUENCE_LABEL: { [k in CooldownProbeMode]: string } = {
    edit: `${EDIT_MISSING_COMMAND}  →  ${EDIT_MISSING_COMMAND}`,
    create: `${EDIT_MISSING_COMMAND}  →  /menu create ${PROBE_MENU}`,
    mutate: `/menu create ${MUTATE_MENU_A}  →  /menu create ${MUTATE_MENU_B}`,
    cleanup: "",
};

export async function runCooldownProbe(ctx: TaskContext, modeName: CooldownProbeMode): Promise<void> {
    if (modeName === "cleanup") {
        await runCleanupMode(ctx);
        return;
    }

    ctx.displayMessage(`&e[cooldownprobe] ${modeName} mode — stand still, don't type. ~2-3 min.`);

    if (!(await preflight(ctx))) {
        ctx.displayMessage(
            "&c[cooldownprobe] no clean probe reply. Stand in your Housing world (where /menu works) and retry."
        );
        return;
    }

    const rows: IntervalRow[] = [];
    if (modeName === "edit") {
        await runEditTrials(ctx, rows);
    } else if (modeName === "create") {
        await runCreateTrials(ctx, rows);
    } else {
        await runMutateTrials(ctx, rows);
    }

    const report = buildReport(modeName, SEQUENCE_LABEL[modeName], rows);
    for (let i = 0; i < report.length; i++) ctx.displayMessage(`&f${report[i]}`);

    const path = `./htsw/cooldownprobe-${modeName}-${Date.now()}.txt`;
    try {
        FileLib.write(path, report.join("\n"), true);
        ctx.displayMessage(`&a[cooldownprobe] saved → ${path}`);
    } catch (e) {
        ctx.displayMessage(`&c[cooldownprobe] could not save report: ${e}`);
    }
}
