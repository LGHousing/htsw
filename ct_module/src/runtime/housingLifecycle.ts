/// <reference types="../../CTAutocomplete" />

import { getHousingUuid, setHousingUuid } from "@htsw/importer/runtime/state";
import { getHousingPresence, resetHousingPresence } from "@htsw/importer/importCache/housingPresence";
import { detectHousingUuid, isOwnProbeRejection } from "@htsw/importer/importCache/housingId";
import { cancelActiveTask } from "@htsw/importer/tasks/activeTask";
import { TaskManager } from "@htsw/importer/tasks/manager";
import { closeBoundProjectForHouse, openBoundProjectForHouse } from "@htsw/importer/runtime/boundProject";
import { clearQueue } from "@htsw/importer/runtime/queue";
import { housingWorldLoads } from "@htsw/importer/runtime/events";

// Probe once per server while presence is unknown. Server transport resets the
// verdict and cooldown so the next container open checks the new server.
let uuidFetchInFlight = false;
let lastUuidFetchAt = 0;
const UUID_FETCH_COOLDOWN_MS = 60_000;
let housingServerRevision = 0;

function leaveHousingServer(): void {
    housingServerRevision++;
    const uuid = getHousingUuid();
    cancelActiveTask();
    closeBoundProjectForHouse(uuid);
    clearQueue();
    setHousingUuid(null);
    resetHousingPresence();
    lastUuidFetchAt = 0;
}

export function tickHousingLifecycle(containerOpen: boolean): void {
    if (!containerOpen) return;
    if (uuidFetchInFlight) return;
    if (getHousingPresence() !== "unknown") return;
    if (Date.now() - lastUuidFetchAt < UUID_FETCH_COOLDOWN_MS) return;
    const serverRevision = housingServerRevision;
    const task = TaskManager.tryRun(async (ctx) => {
        const uuid = await detectHousingUuid(ctx);
        if (serverRevision !== housingServerRevision) {
            resetHousingPresence();
            return;
        }
        if (uuid !== null) {
            setHousingUuid(uuid);
            openBoundProjectForHouse(uuid);
        }
    });
    if (task === null) return;
    uuidFetchInFlight = true;
    lastUuidFetchAt = Date.now();
    void task
        .catch(() => {
            /* timeout — stay "unknown" and allow a retry after the cooldown */
        })
        .then(() => {
            uuidFetchInFlight = false;
        });
}

let initialized = false;
export function initHousingLifecycle(): void {
    if (initialized) return;
    initialized = true;
    // Hypixel server-transport messages are the cleanest "you may have
    // changed housings" signal. When we see one, drop the cached UUID and
    // cache-status rows so the next inventory open re-runs `/wtfmap` for the
    // new server. Both `setCriteria("Sending you to ${server}...")` and a
    // `^Sending you to ` regex were observed to silently never fire here,
    // so we match on `${*}` and prefix-test the unformatted message in JS.
    // We also clear `lastUuidFetchAt`: a prior failed `/wtfmap` (e.g. one
    // attempted from a lobby) sets the cooldown, which would otherwise
    // gate the next auto-fetch in the new housing for up to 60s.
    // Read the event through a declared parameter only: on this Rhino build,
    // pulling a ClientChatReceivedEvent out of `arguments` (which is what a
    // `...args` rest parameter compiles to) throws
    // "InternalError: Invalid JavaScript value" and silently kills the handler.
    register("chat", (event) => {
        // @ts-expect-error CTAutocomplete's chat trigger event type is too narrow here.
        const msg = ChatLib.getChatMessage(event, false);
        if (typeof msg !== "string") return;
        if (isOwnProbeRejection(msg)) {
            // Later chat triggers (the probe's waiter included) still see a
            // cancelled line; only the player doesn't.
            cancel(event);
            return;
        }
        if (msg.indexOf("Sending you to ") !== 0) return;
        leaveHousingServer();
    });

    register("worldLoad", () => {
        housingWorldLoads.emit();
        leaveHousingServer();
    });
}
