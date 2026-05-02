import "promise-polyfill/src/polyfill";
import "./injectLong";
import "./tasks/manager";

import { registerCommands } from "./commands";
import { registerExportCommands } from "./exporter";
import { initMcpBridge } from "./mcp/bridge";
import { initHtswGui } from "./gui/overlay";

registerCommands();
registerExportCommands();
initMcpBridge();
initHtswGui();
