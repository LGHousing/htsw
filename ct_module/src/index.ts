import "promise-polyfill/src/polyfill";
import "./polyfills/promiseSyncDrain";
import "./injectLong";
import "./tasks/manager";

import { registerSlashCommands } from "./slashCommands";
import { initMcpBridge } from "./mcp/bridge";
import { initHtswGui } from "./gui/overlay";
import { initAutoUpdate } from "./autoUpdate";

registerSlashCommands();
initMcpBridge();
initHtswGui();
initAutoUpdate();
