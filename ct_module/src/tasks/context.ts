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

const COMMAND_INTERVAL_MS = 250;

export default class TaskContext {
    private cancelled: boolean = false;
    private nextCommandAt: number = 0;

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

    public async runCommand(command: string): Promise<void> {
        if (!command.startsWith("/")) {
            throw new Error(`Invalid command: ${command}`);
        }
        const waitMs = this.nextCommandAt - Date.now();
        if (waitMs > 0) {
            await this.sleep(waitMs);
        }
        this.nextCommandAt = Date.now() + COMMAND_INTERVAL_MS;
        ChatLib.say(command);
    }

    public sendMessage(message: string) {
        if (message.startsWith("/")) {
            throw new Error(`Invalid message: ${message}`);
        }
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
