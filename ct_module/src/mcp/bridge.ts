/// <reference types="../../CTAutocomplete" />

/**
 * MCP bridge: polls the host MCP server for commands to execute and forwards
 * recent chat back. Activated only when the deployed module dir contains a
 * mcp.json with `enabled: true` (install.py writes that file from .env).
 */

// @ts-ignore
const URLClass = java.net.URL;
// @ts-ignore
const BufferedReaderClass = java.io.BufferedReader;
// @ts-ignore
const InputStreamReaderClass = java.io.InputStreamReader;
// @ts-ignore
const OutputStreamWriterClass = java.io.OutputStreamWriter;

const CONFIG_PATH = "./config/ChatTriggers/modules/HTSW/mcp.json";
const POLL_TICK_INTERVAL = 10; // ~2 polls/sec
const FLUSH_TICK_INTERVAL = 10;
const CHAT_FLUSH_BATCH = 50;

interface BridgeConfig {
    enabled: boolean;
    port: number;
}

let config: BridgeConfig | null = null;
let chatQueue: string[] = [];
let tickCounter = 0;
let inFlight = false;
let lastErrorAt = 0;

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

function logErrorThrottled(msg: string): void {
    const now = Date.now();
    if (now - lastErrorAt < 5000) return;
    lastErrorAt = now;
    ChatLib.chat(`&7[htsw-mcp] &c${msg}`);
}

function httpGet(path: string): string | null {
    if (config === null) return null;
    try {
        const url = new URLClass(`http://127.0.0.1:${config.port}${path}`);
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
    } catch (e) {
        logErrorThrottled(`GET ${path} failed: ${e}`);
        return null;
    }
}

function httpPostJson(path: string, body: unknown): boolean {
    if (config === null) return false;
    try {
        const url = new URLClass(`http://127.0.0.1:${config.port}${path}`);
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
    } catch (e) {
        logErrorThrottled(`POST ${path} failed: ${e}`);
        return false;
    }
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

function pollAndExecute(): void {
    if (inFlight || config === null || !config.enabled) return;
    inFlight = true;
    try {
        const raw = httpGet("/poll");
        if (raw === null) return;
        const parsed = JSON.parse(raw);
        const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
        for (let i = 0; i < commands.length; i++) {
            const entry = commands[i];
            if (
                entry !== null &&
                typeof entry === "object" &&
                typeof entry.command === "string"
            ) {
                const clientSide = entry.clientSide !== false; // default true
                executeBridgeCommand(entry.command, clientSide);
            }
        }
    } catch (e) {
        logErrorThrottled(`poll parse failed: ${e}`);
    } finally {
        inFlight = false;
    }
}

function flushChat(): void {
    if (config === null || !config.enabled) return;
    if (chatQueue.length === 0) return;
    const batch = chatQueue.splice(0, CHAT_FLUSH_BATCH);
    httpPostJson("/chat", { lines: batch });
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
        if (tickCounter % POLL_TICK_INTERVAL === 0) pollAndExecute();
        if (tickCounter % FLUSH_TICK_INTERVAL === 0) flushChat();
    });
}
