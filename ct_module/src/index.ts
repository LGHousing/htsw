import "promise-polyfill/src/polyfill";
import "./polyfills/promiseSyncDrain";
import "./injectLong";
import "./tasks/manager";

import { registerCommands } from "./commands";
import { registerExportCommands } from "./exporter";
import { initMcpBridge } from "./mcp/bridge";
import { initHtswGui } from "./gui/overlay";
import { backgroundPreloadIcons } from "./gui/lib/render";

registerCommands();
registerExportCommands();
initMcpBridge();
initHtswGui();
backgroundPreloadIcons();
