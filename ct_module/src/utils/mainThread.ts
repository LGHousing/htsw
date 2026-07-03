const Runnable = Java.type("java.lang.Runnable");

/**
 * Run `fn` on the main client thread — inline when already there, otherwise
 * via Minecraft's scheduled-task queue (drained every frame, submission order
 * preserved).
 *
 * CT fires `packetReceived`/`packetSent` triggers on Netty IO threads. With
 * the sync-drain promise polyfill, resolving a waiter from such a trigger
 * resumes the awaiting import code on that Netty thread, and any GUI call it
 * then makes (screen open/close, container clicks) hard-crashes 1.8.9 —
 * observed as Essential's "Detected call to `openScreen` on thread Netty
 * Client IO" followed by a client crash mid-import.
 */
export function runOnMainThread(fn: () => void): void {
    const mc = Client.getMinecraft() as unknown as {
        // func_152345_ab = isCallingFromMinecraftThread
        func_152345_ab(): boolean;
        // func_152344_a = addScheduledTask(Runnable)
        func_152344_a(task: unknown): unknown;
    };
    if (mc.func_152345_ab()) {
        fn();
        return;
    }
    mc.func_152344_a(new Runnable({ run: fn }));
}
