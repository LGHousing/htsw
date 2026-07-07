/// <reference types="../../CTAutocomplete" />

/**
 * MCP bridge: polls the host MCP server for commands to execute and forwards
 * recent chat back. Activated only when the deployed module dir contains a
 * mcp.json with `enabled: true` (install.py writes that file from .env).
 *
 * All HTTP IO happens on daemon threads — never on the tick thread. The tick
 * handler only schedules work and drains result queues. When the server is
 * unreachable, exponential backoff keeps us from hammering retries.
 */

// @ts-expect-error CTAutocomplete does not type lowercase Java package globals.
const URLClass = java.net.URL;
// @ts-expect-error CTAutocomplete does not type lowercase Java package globals.
const BufferedReaderClass = java.io.BufferedReader;
// @ts-expect-error CTAutocomplete does not type lowercase Java package globals.
const InputStreamReaderClass = java.io.InputStreamReader;
// @ts-expect-error CTAutocomplete does not type lowercase Java package globals.
const OutputStreamWriterClass = java.io.OutputStreamWriter;
const Thread = Java.type("java.lang.Thread");
const Runnable = Java.type("java.lang.Runnable");
const AtomicBoolean = Java.type("java.util.concurrent.atomic.AtomicBoolean");
const ConcurrentLinkedQueue = Java.type("java.util.concurrent.ConcurrentLinkedQueue");

const CONFIG_PATH = "./config/ChatTriggers/modules/HTSW/mcp.json";
const POLL_TICK_INTERVAL = 10; // ~2 polls/sec when healthy
const FLUSH_TICK_INTERVAL = 10;
const CHAT_FLUSH_BATCH = 50;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;

interface BridgeConfig {
    enabled: boolean;
    port: number;
}

interface PendingCommand {
    command: string;
    clientSide: boolean;
}

let config: BridgeConfig | null = null;
let chatQueue: string[] = [];
let tickCounter = 0;
const pollInFlight: any = new AtomicBoolean(false);
const flushInFlight: any = new AtomicBoolean(false);
const pendingCommands: any = new ConcurrentLinkedQueue();
let pollBackoffUntilMs = 0;
let pollConsecutiveFailures = 0;

function loadConfig(): BridgeConfig | null {
    try {
        const raw = FileLib.read(CONFIG_PATH);
        if (raw === null || raw === undefined || String(raw).length === 0) {
            return null;
        }
        const parsed = JSON.parse(String(raw));
        if (typeof parsed !== "object" || parsed === null) return null;
        const enabled = parsed.enabled === true;
        const port =
            typeof parsed.port === "number" && parsed.port > 0 ? parsed.port : 37123;
        return { enabled, port };
    } catch (_e) {
        return null;
    }
}

function registerPollFailure(): void {
    pollConsecutiveFailures++;
    const exp = Math.min(6, pollConsecutiveFailures);
    pollBackoffUntilMs = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (1 << exp));
}

// Synchronous HTTP — only ever invoked from a daemon worker thread. A dead or
// unreachable server is the normal resting state (no agent driving the bridge),
// so connection failures are silent: schedulePoll's backoff paces the retries.
function httpGetSync(port: number, path: string): string | null {
    try {
        const url = new URLClass(`http://127.0.0.1:${port}${path}`);
        const conn = url.openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(500);
        conn.setReadTimeout(1500);
        const reader = new BufferedReaderClass(
            new InputStreamReaderClass(conn.getInputStream(), "UTF-8")
        );
        let result = "";
        let line: string | null = reader.readLine();
        while (line !== null) {
            result += line;
            line = reader.readLine();
        }
        reader.close();
        return result;
    } catch (_e) {
        return null;
    }
}

function httpPostJsonSync(port: number, path: string, body: unknown): boolean {
    try {
        const url = new URLClass(`http://127.0.0.1:${port}${path}`);
        const conn = url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setDoOutput(true);
        conn.setConnectTimeout(500);
        conn.setReadTimeout(1500);
        const writer = new OutputStreamWriterClass(conn.getOutputStream(), "UTF-8");
        writer.write(JSON.stringify(body));
        writer.flush();
        writer.close();
        const code = conn.getResponseCode();
        conn.disconnect();
        return code >= 200 && code < 300;
    } catch (_e) {
        return false;
    }
}

function spawnDaemon(fn: () => void): void {
    const t = new Thread(
        new Runnable({
            run: function () {
                try {
                    fn();
                } catch (_e) {
                    /* swallow — error already reported */
                }
            },
        })
    );
    t.setDaemon(true);
    t.start();
}

function executeBridgeCommand(command: string, clientSide: boolean): void {
    if (command.length === 0) return;
    if (command.charAt(0) === "/") {
        ChatLib.command(command.slice(1), clientSide);
    } else {
        // ChatLib.say always reaches the server — clientSide is meaningless here.
        ChatLib.say(command);
    }
}

function drainCommands(): void {
    while (true) {
        const entry = pendingCommands.poll() as PendingCommand | null;
        if (entry === null) break;
        executeBridgeCommand(entry.command, entry.clientSide);
    }
}

function schedulePoll(): void {
    if (config === null || !config.enabled) return;
    if (Date.now() < pollBackoffUntilMs) return;
    if (!pollInFlight.compareAndSet(false, true)) return;
    const port = config.port;
    spawnDaemon(() => {
        try {
            const raw = httpGetSync(port, "/poll");
            if (raw === null) {
                registerPollFailure();
                return;
            }
            let parsed: any;
            try {
                parsed = JSON.parse(raw);
            } catch (_e) {
                registerPollFailure();
                return;
            }
            pollConsecutiveFailures = 0;
            pollBackoffUntilMs = 0;
            const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
            for (let i = 0; i < commands.length; i++) {
                const entry = commands[i];
                if (
                    entry !== null &&
                    typeof entry === "object" &&
                    typeof entry.command === "string"
                ) {
                    pendingCommands.add({
                        command: entry.command,
                        clientSide: entry.clientSide !== false,
                    });
                }
            }
        } finally {
            pollInFlight.set(false);
        }
    });
}

function scheduleFlush(): void {
    if (config === null || !config.enabled) return;
    // Reuse the poll's reachability signal: if polls are backing off, the server
    // is unreachable, so don't burn POST attempts (and drop batches) against it.
    if (Date.now() < pollBackoffUntilMs) return;
    if (chatQueue.length === 0) return;
    if (!flushInFlight.compareAndSet(false, true)) return;
    const batch = chatQueue.splice(0, CHAT_FLUSH_BATCH);
    const port = config.port;
    spawnDaemon(() => {
        try {
            httpPostJsonSync(port, "/chat", { lines: batch });
        } finally {
            flushInFlight.set(false);
        }
    });
}

export function initMcpBridge(): void {
    config = loadConfig();
    if (config === null || !config.enabled) return;

    ChatLib.chat(`&7[htsw-mcp] bridge enabled (port ${config.port})`);

    register("chat", (event: any) => {
        try {
            const message = ChatLib.getChatMessage(event, true);
            if (typeof message === "string" && message.length > 0) {
                chatQueue.push(message);
                if (chatQueue.length > 1000) {
                    chatQueue = chatQueue.slice(-500);
                }
            }
        } catch (_e) {
            // ignore
        }
    }).setCriteria("${*}");

    register("tick", () => {
        tickCounter++;
        drainCommands();
        if (tickCounter % POLL_TICK_INTERVAL === 0) schedulePoll();
        if (tickCounter % FLUSH_TICK_INTERVAL === 0) scheduleFlush();
    });
}
