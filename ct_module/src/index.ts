import "promise-polyfill/src/polyfill";
import "./polyfills/promiseSyncDrain";
import "./injectLong";
import "./injectHousingDecimal";
import "./tasks/manager";

import { registerSlashCommands } from "./slashCommands";
import { initHtswGui } from "./gui/overlay";
// Registers the workspace slices; imported for its side effects only. Placed
// after the overlay import so the GUI modules still initialize in their
// original order — several rely on deferred Java interop that assumes it.
import "./gui/persistence/workspaceSlices";
import { initAutoUpdate } from "./autoUpdate";
import { initSessionHeartbeat } from "./runtimeDebug/sessionHeartbeat";
import { initPersistence } from "./persistence/tick";
import { initStatusBridge } from "./bridge/runtime";

initStatusBridge();
registerSlashCommands();
initHtswGui();
initAutoUpdate();
initSessionHeartbeat();
initPersistence();
