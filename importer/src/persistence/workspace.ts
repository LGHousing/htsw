import {
    defineDoc,
    defineValue,
    flushPersistence,
    resetDoc,
    type ValueParser,
} from "./store";
import { getRestoreWorkspace } from "../settings";

/**
 * The restorable workspace: which projects are open, which files are in tabs,
 * how the tree is expanded, and what is queued.
 *
 * Slices register themselves rather than being reached into from here. That
 * keeps the dependency edges pointing one way (feature -> workspace, never
 * back), so persisting a new piece of GUI state is one `defineWorkspaceSlice`
 * call next to the state it describes, with no edit to this file and no call
 * site to remember at every mutation.
 *
 * Capture is polled, not event-driven, for the same reason: a slice is saved
 * because it is registered, not because every place that mutates it also
 * remembered to announce it. The poll is throttled and skips the write when
 * the serialized form is unchanged, so an idle session does no disk IO.
 */

const WORKSPACE = defineDoc({
    file: "workspace.json",
    // Regenerable by definition — a workspace that cannot be read should
    // start clean, not wedge itself.
    onReadError: "defaults",
    pretty: true,
    // Coalesce: tree expansion and tab switches fire on user input, and a
    // write per click would be pointless churn.
    debounceMs: 1000,
});

/**
 * A registered slice, with its value type sealed inside the closures. Keeping
 * `T` out of the shared list means no casts at the boundary and no way for one
 * slice's shape to be applied to another's state.
 */
type Slice = {
    restore: () => void;
    capture: () => void;
    /** Forget the last-written form so the next capture always writes. */
    forget: () => void;
};

const slices: Slice[] = [];

export function defineWorkspaceSlice<T>(options: {
    key: string;
    fallback: T;
    parse: ValueParser<T>;
    capture: () => T;
    restore: (value: T) => void;
    serialize?: (value: T) => unknown;
}): void {
    const value = defineValue<T>(WORKSPACE, {
        key: options.key,
        fallback: options.fallback,
        parse: options.parse,
        serialize: options.serialize,
    });
    // Serialized form at the last write, used to skip no-op saves so an idle
    // session does no disk IO.
    let lastSerialized: string | null = null;
    slices.push({
        restore: () => {
            const stored = value.get();
            options.restore(stored);
            // Seed the change detector so an unmodified session doesn't
            // immediately rewrite the file it just read.
            lastSerialized = safeSerialize(stored);
        },
        capture: () => {
            const current = options.capture();
            const serialized = safeSerialize(current);
            if (serialized === null || serialized === lastSerialized) return;
            lastSerialized = serialized;
            value.set(current);
        },
        forget: () => {
            lastSerialized = null;
        },
    });
}

let restored = false;
/**
 * Set by `resetWorkspace` for the remainder of the session. Without it the
 * next poll would write the still-open session straight back into the file we
 * just cleared, and "reset" would visibly do nothing on the next launch.
 */
let suspended = false;
let lastCaptureAt = 0;
const CAPTURE_INTERVAL_MS = 2000;

/** True once the saved workspace has been applied (or deliberately skipped). */
export function isWorkspaceRestored(): boolean {
    return restored;
}

function restoreOnce(): void {
    restored = true;
    if (!getRestoreWorkspace()) return;
    for (let i = 0; i < slices.length; i++) {
        try {
            slices[i].restore();
        } catch (_e) {
            // One unrestorable slice must not cost the user the rest of the
            // workspace — a moved project should not also lose their filters.
        }
    }
}

function safeSerialize(value: unknown): string | null {
    try {
        // Widened past the lib signature on purpose: JSON.stringify really
        // does return undefined for undefined and function inputs, and a
        // slice whose capture returns nothing must not be written as "null".
        const json = JSON.stringify(value) as string | undefined;
        return json === undefined ? null : json;
    } catch (_e) {
        return null;
    }
}

function captureAll(): void {
    for (let i = 0; i < slices.length; i++) {
        try {
            slices[i].capture();
        } catch (_e) {
            // Skip this slice for now; the next poll tries again.
        }
    }
}

/**
 * Drive restore-then-capture. Called from the client tick so the workspace
 * still saves when the overlay is closed, and restore happens off the module
 * load path — top-level Java interop is known to hang CT 1.8.9 at load.
 */
export function tickWorkspace(): void {
    if (suspended) return;
    if (!restored) {
        restoreOnce();
        return;
    }
    if (!getRestoreWorkspace()) return;
    const now = Date.now();
    if (now - lastCaptureAt < CAPTURE_INTERVAL_MS) return;
    lastCaptureAt = now;
    captureAll();
}

/**
 * Capture and write immediately, ignoring both throttles. Used on overlay
 * close, where the user's last action should be durable even if the game
 * exits before the next poll.
 */
export function flushWorkspace(): void {
    if (suspended || !restored || !getRestoreWorkspace()) return;
    captureAll();
    flushPersistence(true);
}

let overlayWasVisible = false;

/**
 * Flush on the overlay's visible -> hidden edge. Closing the GUI is the
 * natural end of a burst of workspace edits, and the most likely moment for
 * the player to quit the game outright.
 */
export function noteOverlayVisibility(visible: boolean): void {
    if (overlayWasVisible && !visible) flushWorkspace();
    overlayWasVisible = visible;
}

/**
 * Clear the saved workspace. The in-memory session is left alone — the point
 * is a clean *next* launch, not yanking the user's open tabs out from under
 * them. Saving stops for the rest of the session so the cleared file stays
 * cleared.
 */
export function resetWorkspace(): boolean {
    suspended = true;
    for (let i = 0; i < slices.length; i++) slices[i].forget();
    return resetDoc(WORKSPACE);
}
