import { removedFormatting } from "../helpers";
import { findItemSlot as findItemSlot, getItemSlots, ItemSlot } from "./specifics/slots";
import { waitFor } from "./specifics/waitFor";

export default class TaskContext {
    private cancelled: boolean = false;

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

    public runCommand(command: string) {
        if (!command.startsWith("/")) {
            throw new Error(`Invalid command: ${command}`);
        }
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
        promise: Promise<T>,
        reason: string,
        duration: number = 2000
    ): Promise<T> {
        const timeoutPromise = new Promise<T>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Timeout after ${duration}ms: ${reason}`));
            }, duration);
        });

        return Promise.race([promise, timeoutPromise]);
    }

    getItemSlots = getItemSlots;
    findItemSlot = findItemSlot;
    waitFor = waitFor;
}
