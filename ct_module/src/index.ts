import "promise-polyfill/src/polyfill";
import "./polyfills/promiseSyncDrain";
import "./injectLong";
import "./injectHousingDecimal";
import "./tasks/manager";

import { registerSlashCommands } from "./slashCommands";
import { initHtswGui } from "./gui/overlay";
import { initAutoUpdate } from "./autoUpdate";
import { initSessionHeartbeat } from "./runtimeDebug/sessionHeartbeat";

registerSlashCommands();
initHtswGui();
initAutoUpdate();
initSessionHeartbeat();
