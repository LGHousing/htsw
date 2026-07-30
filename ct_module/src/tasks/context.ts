import {
    tryGetItemSlot,
    getAllItemSlots,
    getItemSlot,
    tryGetMenuItemSlot,
    getMenuItemSlots,
    getMenuItemSlot,
    getOpenContainerTitle,
} from "./specifics/slots";
import { waitFor, waitForTimeout, type WaitForPromise } from "./specifics/waitFor";
import { C01PacketChatMessage } from "../utils/packets";
import { sendPacket } from "../utils/java";
import { recordRuntimeDebug } from "../runtimeDebug/runtimeDebugBuffer";
import { createTaskCancelledError } from "./cancellation";

/**
 * Hypixel accepts chat payloads up to 256 chars, but MC 1.8.9's
 * `C01PacketChatMessage` constructor truncates client-side at 100. We
 * bypass that cap by reflection (see `sendMessage`) and cap at the
 * server's real limit so a longer value is trimmed deterministically
 * rather than rejected.
 */
const MAX_CHAT_MESSAGE_LENGTH = 256;
const ALL_CHAT_PREFIX = "/ac ";
const MAX_CHAT_VALUE_LENGTH =
    MAX_CHAT_MESSAGE_LENGTH - ALL_CHAT_PREFIX.length;

/**
 * Hypixel's chat anti-spam works as a heat budget: every chat sent to
 * the server costs `HEAT_PER_CHAT`, heat dissipates one unit per server
 * tick (20 ticks/sec), and crossing `HEAT_KICK_THRESHOLD` disconnects
 * the player. We mirror that accounting client-side and throttle
 * just-in-time — at low heat commands fire instantly, only backing off
 * when sending one more would cross the safety line.
 *
 * `HEAT_SAFETY_MARGIN` reserves a buffer below the kick threshold for
 * clock skew and the round-trip between our send and the server
 * registering it; without it a burst that lands at exactly the limit
 * gets booted. A 50-unit margin permits a ~7-chat instant burst from
 * cold and falls back to ~1 chat/sec sustained, matching the
 * dissipation rate.
 *
 * Two further hedges against client/server clock disagreement on a long
 * chat-heavy import (the real kick cause, since every send already goes
 * through `awaitChatBudget`): dissipation is under-credited ~5% so we
 * believe heat falls slightly slower than the server does, and a fixed
 * inter-chat floor (`CHAT_MIN_INTERVAL_MS`) keeps even a cold burst from
 * out-running the server's per-message accounting.
 */
const HEAT_PER_CHAT = 20;
const HEAT_DISSIPATION_PER_MS = (20 / 1000) * 0.95;
const HEAT_KICK_THRESHOLD = 200;
const HEAT_SAFETY_MARGIN = 50;
const HEAT_MAX_POST_SEND = HEAT_KICK_THRESHOLD - HEAT_SAFETY_MARGIN;
const CHAT_MIN_INTERVAL_MS = 50;

/**
 * Housing rejects a slash command sent too soon after the previous one with
 * "This command is on cooldown! Try again in about a second!" — a fast
 * `/menu edit`→`/menu create` loses the create and the import stalls waiting
 * for a confirmation that never comes. The "about a second" wording is
 * misleading: the measured threshold is ~150ms (the `/htsw cooldownprobe`
 * diagnostic saw edit→create clean at ~180ms and throttled at ~115ms;
 * create→create clean by 200ms). This floor spaces consecutive commands past
 * it with round-trip margin. Field-value input goes through `sendMessage`, not
 * here, so this never touches the per-field import hot path; only the sparse
 * navigation/creation commands pay, and only when they'd otherwise fire
 * back-to-back.
 */
const COMMAND_COOLDOWN_MS = 300;

export type TaskWaiter<T> = {
    label: string;
    start(ctx: TaskContext): WaitForPromise<T>;
};

export default class TaskContext {
    public readonly startedAt: number = Date.now();
    private cancelled: boolean = false;
    private forcedCancellation: boolean = false;
    private cancellationDeferrals: number = 0;
    private heatLevel: number = 0;
    private heatLastUpdate: number = 0;
    private heatLastChatAt: number = 0;
    private lastCommandAt: number = 0;

    public elapsedMs(): number {
        return Math.max(0, Date.now() - this.startedAt);
    }

    public cancel() {
        this.cancelled = true;
    }

    public forceCancel() {
        this.cancelled = true;
        this.forcedCancellation = true;
    }

    public isCancelled(): boolean {
        return this.cancelled;
    }

    private shouldCancelNow(): boolean {
        return (
            this.cancelled &&
            (this.forcedCancellation || this.cancellationDeferrals === 0)
        );
    }

    public checkCancelled() {
        if (this.shouldCancelNow()) {
            throw createTaskCancelledError();
        }
    }

    public async finishBeforeCancelling<T>(run: () => Promise<T>): Promise<T> {
        this.checkCancelled();
        const result = await this.finishCancellationCleanup(run);
        this.checkCancelled();
        return result;
    }

    public async finishCancellationCleanup<T>(run: () => Promise<T>): Promise<T> {
        this.cancellationDeferrals++;
        try {
            return await run();
        } finally {
            this.cancellationDeferrals--;
        }
    }

    private decayHeatToNow(): number {
        const now = Date.now();
        if (this.heatLastUpdate !== 0) {
            // Clamp so a backwards clock step (NTP adjustment, resume from
            // sleep) can't yield negative elapsed → phantom heat gain.
            const elapsed = Math.max(0, now - this.heatLastUpdate);
            const dissipated = elapsed * HEAT_DISSIPATION_PER_MS;
            this.heatLevel = Math.max(0, this.heatLevel - dissipated);
        }
        this.heatLastUpdate = now;
        return this.heatLevel;
    }

    /**
     * Wait just long enough that the next chat lands at or under
     * `HEAT_MAX_POST_SEND`, then record its heat cost. Returns instantly
     * when there's room in the budget — bursts at low heat fire as fast
     * as the JS event loop can dispatch them.
     */
    private async awaitChatBudget(): Promise<void> {
        const heat = this.decayHeatToNow();
        const overshoot = heat + HEAT_PER_CHAT - HEAT_MAX_POST_SEND;
        if (overshoot > 0) {
            await this.sleep(Math.ceil(overshoot / HEAT_DISSIPATION_PER_MS));
            this.decayHeatToNow();
        }
        const sinceLastChat = Date.now() - this.heatLastChatAt;
        if (this.heatLastChatAt !== 0 && sinceLastChat < CHAT_MIN_INTERVAL_MS) {
            await this.sleep(CHAT_MIN_INTERVAL_MS - sinceLastChat);
            this.decayHeatToNow();
        }
        this.heatLevel += HEAT_PER_CHAT;
        this.heatLastChatAt = Date.now();
    }

    private async awaitCommandCooldown(): Promise<void> {
        if (this.lastCommandAt === 0) return;
        const sinceLastCommand = Date.now() - this.lastCommandAt;
        if (sinceLastCommand < COMMAND_COOLDOWN_MS) {
            await this.sleep(COMMAND_COOLDOWN_MS - sinceLastCommand);
        }
    }

    public async runCommand(command: string): Promise<void> {
        if (!command.startsWith("/")) {
            throw new Error(`Invalid command: ${command}`);
        }
        await this.awaitCommandCooldown();
        await this.awaitChatBudget();
        ChatLib.say(command);
        recordRuntimeDebug("command", { command });
        this.lastCommandAt = Date.now();
    }

    public async sendMessage(message: string): Promise<void> {
        if (message.startsWith("/")) {
            throw new Error(`Invalid chat prompt value: ${message}`);
        }
        await this.awaitChatBudget();
        const cappedValue =
            message.length > MAX_CHAT_VALUE_LENGTH
                ? message.substring(0, MAX_CHAT_VALUE_LENGTH)
                : message;
        const outgoingMessage = ALL_CHAT_PREFIX + cappedValue;
        // ChatLib.say builds a C01PacketChatMessage whose constructor cuts
        // the string to 100 chars. Build the packet with a dummy value and
        // overwrite the message field by reflection so the full (≤256) message
        // reaches the server.
        const packet = new C01PacketChatMessage("");
        const messageField = packet.class.getDeclaredField("field_149440_a");
        messageField.setAccessible(true);
        messageField.set(packet, outgoingMessage);
        sendPacket(packet);
        recordRuntimeDebug("chatInput", { length: outgoingMessage.length });
    }

    public displayMessage(message: string) {
        ChatLib.chat(message);
    }

    public async sleep(
        duration: number | "forever", // duration in milliseconds
        abortCheck?: () => boolean
    ): Promise<void> {
        if (duration === "forever") {
            duration = 315576000000;
        }

        const end = Date.now() + duration;
        for (;;) {
            this.checkCancelled();
            if (abortCheck && abortCheck()) {
                throw new Error("Sleep aborted by custom check");
            }
            if (Date.now() >= end) return;
            // Drive off the tick register, not setTimeout. CT's setTimeout rides a
            // Java timer that starves under a busy import (e.g. a chat-heavy
            // PLAY_SOUND function constantly hitting the heat budget), so its
            // callback can fail to fire and orphan the wait forever while the game
            // stays responsive. Ticks fire on the main thread like every other
            // importer wait.
            await this.waitFor("tick");
        }
    }

    public withTimeout<T>(
        promise: Promise<T> | (() => Promise<T>),
        reason: string,
        duration: number = 2000
    ): WaitForPromise<T> {
        if (this.shouldCancelNow()) {
            const rejected = Promise.reject(
                createTaskCancelledError()
            ) as WaitForPromise<T>;
            rejected.cleanupWaiter = () => {};
            rejected.catch(() => {});
            return rejected;
        }
        const pending = typeof promise === "function" ? promise() : promise;
        const innerCleanup = (pending as WaitForPromise<T>).cleanupWaiter;
        const timeout = waitForTimeout(
            reason,
            duration,
            () => this.shouldCancelNow(),
            innerCleanup
        );
        timeout.catch(() => {});

        const raced = Promise.race([pending, timeout]).then(
            (value): T => {
                timeout.cleanupWaiter?.();
                return value;
            },
            (error: unknown): never => {
                timeout.cleanupWaiter?.();
                throw error;
            }
        ) as WaitForPromise<T>;
        raced.cleanupWaiter = (): void => {
            timeout.cleanupWaiter?.();
            innerCleanup?.();
        };
        raced.catch(() => {});
        return raced;
    }

    public async expectAfter<T>(
        action: () => unknown,
        waiterFactory: TaskWaiter<T>,
        duration: number = 8000
    ): Promise<T> {
        const waiter = waiterFactory.start(this);
        try {
            await action();
            return await this.withTimeout(waiter, waiterFactory.label, duration);
        } catch (error) {
            waiter.cleanupWaiter?.();
            throw error;
        }
    }

    /**
     * `Promise.race` that calls `cleanupWaiter` on every entry once a winner
     * settles. Use this instead of `Promise.race` whenever any racer is a
     * `WaitForPromise` — plain `Promise.race` leaves the loser's container
     * in `EVENT_CONTAINERS`, where it can silently match a future packet
     * meant for an unrelated `waitFor`.
     *
     * Each entry is `[promiseToRace, waiterToCleanup]`. The two are usually
     * the same `WaitForPromise`, but the first can be a wrapper (e.g.
     * `waiter.then(() => tag)`) when you need to discriminate which racer
     * won. Pass `null` as the second element if the entry has nothing to
     * clean up.
     */
    public race<T>(
        entries: ReadonlyArray<[Promise<T>, WaitForPromise<unknown> | null]>
    ): WaitForPromise<T> {
        const cleanupAll = (): void => {
            for (let i = 0; i < entries.length; i++) {
                entries[i][1]?.cleanupWaiter?.();
            }
        };
        const promise = Promise.race(entries.map((e) => e[0])).then(
            (value) => {
                cleanupAll();
                return value;
            },
            (err: unknown) => {
                cleanupAll();
                throw err;
            }
        ) as WaitForPromise<T>;
        // Expose cleanup so an outer withTimeout (or a cancelling caller) that
        // abandons this race still tears down the loser waiters. Without this,
        // the `.then` above only runs when the race itself settles — if the
        // outer timeout fires first, every entry's waiter leaks into
        // EVENT_CONTAINERS. cleanupWaiter on each entry is idempotent, so the
        // settle path and the timeout path can both call cleanupAll safely.
        promise.cleanupWaiter = cleanupAll;
        return promise;
    }

    getAllItemSlots = getAllItemSlots;
    tryGetItemSlot = tryGetItemSlot;
    getItemSlot = getItemSlot;
    getMenuItemSlots = getMenuItemSlots;
    tryGetMenuItemSlot = tryGetMenuItemSlot;
    getMenuItemSlot = getMenuItemSlot;
    getOpenContainerTitle = getOpenContainerTitle;

    waitFor = waitFor;
}
