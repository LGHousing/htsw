import { Observers } from "../utils/observers";

export const runtimeChanges = new Observers<void>();
export const taskPathChanges = new Observers<string>();
export const taskProgressChanges = new Observers<{
    wasRunning: boolean;
    running: boolean;
    needsAttention: boolean;
}>();
export const conflictReviews = new Observers<{ path: string; sourcePath: string }>();
export const boundProjectChanges = new Observers<{
    kind: "open" | "opened" | "close";
    uuid: string | null;
    path: string;
    canonicalPath: string;
}>();

type ToastEvent =
    | {
          kind: "show";
          message: string;
          color: number;
          durationMs: number;
          key: string | null;
      }
    | { kind: "dismiss"; key: string };
export const toasts = new Observers<ToastEvent>();

export function showToast(
    message: string,
    color: number,
    durationMs = 4000,
    key: string | null = null
): void {
    toasts.emit({ kind: "show", message, color, durationMs, key });
}
export function dismissToast(key: string): void {
    toasts.emit({ kind: "dismiss", key });
}

export const housingWorldLoads = new Observers<void>();

export const exportQueueStarts = new Observers<void>();
