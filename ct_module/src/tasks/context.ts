import {
    tryGetItemSlot,
    getAllItemSlots,
    getItemSlot,
    tryGetMenuItemSlot,
    getMenuItemSlots,
    getMenuItemSlot,
    getOpenContainerTitle,
} from "./specifics/slots";
import { waitFor } from "./specifics/waitFor";

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
 * gets booted. A 25-unit margin permits an 8-chat instant burst from
 * cold and falls back to ~1 chat/sec sustained, matching the
 * dissipation rate.
 */
const HEAT_PER_CHAT = 20;
const HEAT_DISSIPATION_PER_MS = 20 / 1000;
const HEAT_KICK_THRESHOLD = 200;
const HEAT_SAFETY_MARGIN = 25;
const HEAT_MAX_POST_SEND = HEAT_KICK_THRESHOLD - HEAT_SAFETY_MARGIN;

export default class TaskContext {
    private cancelled: boolean = false;
    private heatLevel: number = 0;
    private heatLastUpdate: number = 0;

    public cancel() {
        this.cancelled = true;
    }

    public isCancelled(): boolean {
        return this.cancelled;
    }

    public checkCancelled() {
        if (this.cancelled) {
            throw { __taskCancelled: true, reason: "Task cancelled" };
        }
    }

    private decayHeatToNow(): number {
        const now = Date.now();
        if (this.heatLastUpdate !== 0) {
            const elapsed = now - this.heatLastUpdate;
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
        this.heatLevel += HEAT_PER_CHAT;
    }

    public async runCommand(command: string): Promise<void> {
        if (!command.startsWith("/")) {
            throw new Error(`Invalid command: ${command}`);
        }
        await this.awaitChatBudget();
        ChatLib.say(command);
    }

    public async sendMessage(message: string): Promise<void> {
        if (message.startsWith("/")) {
            throw new Error(`Invalid message: ${message}`);
        }
        await this.awaitChatBudget();
        ChatLib.say(message);
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
        while (true) {
            this.checkCancelled();
            if (abortCheck && abortCheck()) {
                throw new Error("Sleep aborted by custom check");
            }
            const remaining = end - Date.now();
            if (remaining <= 0) return;
            await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
        }
    }

    public async withTimeout<T>(
        promise: Promise<T> | (() => Promise<T>),
        reason: string,
        duration: number = 2000
    ): Promise<T> {
        if (this.cancelled) {
            throw { __taskCancelled: true, reason: "Task cancelled" };
        }
        const pending = typeof promise === "function" ? promise() : promise;
        const cleanup = (pending as Promise<T> & { cleanupWaiter?: () => void })
            .cleanupWaiter;
        // Poll the cancel flag so a click on the GUI cancel button takes effect
        // mid-wait instead of after the full timeout. Without this, an import
        // stuck waiting on a menu packet that never arrives would have to burn
        // the entire `duration` per importable before cancellation is observed.
        let settled = false;
        const cancellationPromise = new Promise<T>((_, reject) => {
            const poll = () => {
                if (settled) return;
                if (this.cancelled) {
                    settled = true;
                    cleanup?.();
                    reject({ __taskCancelled: true, reason: "Task cancelled" });
                    return;
                }
                setTimeout(poll, 50);
            };
            setTimeout(poll, 50);
        });
        cancellationPromise.catch(() => {});
        const timeoutPromise = new Promise<T>((_, reject) => {
            setTimeout(() => {
                cleanup?.();
                reject(new Error(`Timeout after ${duration}ms: ${reason}`));
            }, duration);
        });

        try {
            return await Promise.race([pending, timeoutPromise, cancellationPromise]);
        } finally {
            settled = true;
        }
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
