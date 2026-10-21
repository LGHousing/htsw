import "promise-polyfill/src/polyfill";
import "./polyfills/promiseSyncDrain";
import "./injectLong";
import "./injectHousingDecimal";
import "@htsw/importer/tasks/manager";

import { registerSlashCommands } from "./slashCommands";
import { CLIENT_DEBUG_SUBCOMMANDS, CLIENT_SUBCOMMANDS } from "./slashCommands/client";
import { initChatLiveness } from "./importCache/chatLiveness";
import { initHousingLifecycle } from "./runtime/housingLifecycle";
import { initRuntimeGuiObservers } from "./gui/runtimeObservers";
import { initHtswGui } from "./gui/overlay";
// Registers the workspace slices; imported for its side effects only. Placed
// after the overlay import so the GUI modules still initialize in their
// original order — several rely on deferred Java interop that assumes it.
import "./gui/persistence/workspaceSlices";
import { initAutoUpdate } from "./autoUpdate";
import { initSessionHeartbeat } from "./runtimeDebug/sessionHeartbeat";
import { initPersistence } from "./persistence/tick";
import { initStatusBridge } from "./bridge/runtime";

initRuntimeGuiObservers();
initStatusBridge();
initChatLiveness();
registerSlashCommands(CLIENT_SUBCOMMANDS, CLIENT_DEBUG_SUBCOMMANDS);
initHousingLifecycle();
initHtswGui();
initAutoUpdate();
initSessionHeartbeat();
initPersistence();
