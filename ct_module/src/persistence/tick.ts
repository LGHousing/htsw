/// <reference types="../../CTAutocomplete" />

import { flushPersistence } from "./store";
import { tickWorkspace } from "./workspace";

/**
 * Drives workspace restore/capture and the debounced writer from the client
 * tick.
 *
 * Deliberately not tied to the overlay's render loop: the workspace has to
 * keep saving after the GUI is closed, and — more importantly — the first
 * restore must happen off the module load path. Top-level `Java.type` is
 * known to hang CT 1.8.9 at load, and restore reaches into modules that do
 * filesystem interop.
 */
export function initPersistence(): void {
    register("tick", () => {
        try {
            tickWorkspace();
            flushPersistence();
        } catch (_e) {
            // A throw here would unregister the trigger and silently stop all
            // persistence for the rest of the session.
        }
    });
}
