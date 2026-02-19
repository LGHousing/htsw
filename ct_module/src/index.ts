import "promise-polyfill/src/polyfill";
import "./tasks/manager";

import { registerCommands } from "./commands";

registerCommands();
