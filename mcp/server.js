#!/usr/bin/env node
/**
 * HTSW MCP bridge server.
 *
 * Role split so several Claude/agent sessions can drive the same in-game module:
 *   - The first process to bind PORT becomes the *bridge host*: it owns the
 *     command queue + chat buffer and serves HTTP. The in-game ChatTriggers
 *     module polls it (GET /poll) and posts chat to it (POST /chat).
 *   - Every process (host or not) also runs an MCP stdio server whose tools are
 *     thin HTTP clients of 127.0.0.1:PORT. A second/third session that loses the
 *     bind still injects commands (POST /command) and reads chat (GET /chat)
 *     through the host, so there is one shared queue with many drivers.
 *   - Losers keep retrying the bind every 5s, so if the host exits one of them
 *     takes over. Tool calls during that gap return a "bridge not reachable"
 *     error rather than silently dropping into a dead local queue.
 *
 * State lives in the host process, in memory. Restart the host to clear it.
 */

import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PORT = parseInt(process.env.HTSW_MCP_PORT ?? "37123", 10);
const CHAT_BUFFER_LIMIT = 500;

/** @type {{ id: number, command: string, clientSide: boolean }[]} */
const commandQueue = [];
/** @type {{ ts: number, line: string }[]} */
const chatBuffer = [];
let nextCommandId = 1;
let lastClientPollAt = 0;
// True once this process owns the HTTP bridge. Purely informational for the
// tools (which always go over HTTP); it can flip to true later via failover.
let hosting = false;

function pushChat(line) {
    chatBuffer.push({ ts: Date.now(), line: String(line ?? "") });
    while (chatBuffer.length > CHAT_BUFFER_LIMIT) chatBuffer.shift();
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk;
            if (data.length > 1_000_000) {
                req.destroy();
                reject(new Error("body too large"));
            }
        });
        req.on("end", () => {
            if (data.length === 0) return resolve({});
            try {
                resolve(JSON.parse(data));
            } catch (e) {
                reject(e);
            }
        });
        req.on("error", reject);
    });
}

const httpServer = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const path = (req.url ?? "").split("?")[0];
    const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
    try {
        if (req.method === "GET" && path === "/health") {
            res.end(JSON.stringify({ ok: true, queued: commandQueue.length }));
            return;
        }
        // Game side: drain queued commands.
        if (req.method === "GET" && path === "/poll") {
            lastClientPollAt = Date.now();
            const drained = commandQueue.splice(0, commandQueue.length);
            res.end(JSON.stringify({ commands: drained }));
            return;
        }
        // Game side: push forwarded chat lines.
        if (req.method === "POST" && path === "/chat") {
            const body = await readJsonBody(req);
            const lines = Array.isArray(body.lines) ? body.lines : [];
            for (const line of lines) pushChat(line);
            res.end(JSON.stringify({ ok: true, stored: chatBuffer.length }));
            return;
        }
        // MCP-client side: inject a command into the shared queue.
        if (req.method === "POST" && path === "/command") {
            const body = await readJsonBody(req);
            const command = String(body.command ?? "").trim();
            if (command.length === 0) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "command must be non-empty" }));
                return;
            }
            const clientSide = body.clientSide !== false;
            const id = nextCommandId++;
            commandQueue.push({ id, command, clientSide });
            res.end(JSON.stringify({ id, command, clientSide, queued: commandQueue.length }));
            return;
        }
        // MCP-client side: read forwarded chat.
        if (req.method === "GET" && path === "/chat") {
            const limit = Math.min(500, Math.max(1, Number(query.get("limit") ?? 100)));
            const since = Number(query.get("since") ?? 0);
            const filtered = since > 0 ? chatBuffer.filter((c) => c.ts >= since) : chatBuffer;
            res.end(JSON.stringify({ lines: filtered.slice(-limit) }));
            return;
        }
        // MCP-client side: clear the chat buffer.
        if (req.method === "POST" && path === "/clear") {
            chatBuffer.length = 0;
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        // MCP-client side: bridge status.
        if (req.method === "GET" && path === "/status") {
            res.end(JSON.stringify({
                port: PORT,
                queued: commandQueue.length,
                buffered: chatBuffer.length,
                lastPollMs: lastClientPollAt === 0 ? null : Date.now() - lastClientPollAt,
            }));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
});

httpServer.on("listening", () => {
    hosting = true;
    process.stderr.write(`[htsw-mcp] hosting bridge on 127.0.0.1:${PORT}\n`);
});
httpServer.on("error", (err) => {
    hosting = false;
    if (err?.code === "EADDRINUSE") {
        // Another session already hosts the bridge. Run as a client and keep
        // retrying so we take over if that host exits.
        process.stderr.write(
            `[htsw-mcp] port ${PORT} busy; another session hosts the bridge — running as a client, will take over if it exits\n`
        );
        setTimeout(() => httpServer.listen(PORT, "127.0.0.1"), 5000);
        return;
    }
    process.stderr.write(`[htsw-mcp] HTTP listen error: ${err?.message ?? err}\n`);
});
httpServer.listen(PORT, "127.0.0.1");

// The tools always reach the bridge over HTTP — whether this process hosts it
// (loopback to self) or a sibling session does. That one path keeps every
// session's tools working regardless of who won the port.
function bridgeCall(method, path, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request(
            {
                host: "127.0.0.1",
                port: PORT,
                path,
                method,
                timeout: 2500,
                headers: data
                    ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
                    : {},
            },
            (res) => {
                let out = "";
                res.on("data", (c) => (out += c));
                res.on("end", () => {
                    try {
                        resolve({ status: res.statusCode ?? 0, json: out ? JSON.parse(out) : {} });
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("bridge request timed out")));
        if (data) req.write(data);
        req.end();
    });
}

const mcp = new Server(
    { name: "htsw-bridge", version: "0.2.0" },
    { capabilities: { tools: {} } }
);

const TOOLS = [
    {
        name: "htsw_run_command",
        description:
            "Queue a chat command (or plain message) for the HTSW ChatTriggers " +
            "module to run in Minecraft. Include the leading slash for commands. " +
            "Works from any session: the command lands in the shared bridge queue " +
            "and the in-game module runs it. Returns immediately — call " +
            "htsw_read_chat after a short delay to see the result. Requires the " +
            "module running in-game with the bridge enabled.",
        inputSchema: {
            type: "object",
            properties: {
                command: {
                    type: "string",
                    description: "e.g. '/htsw gui' or '/htsw version'",
                },
                client_side: {
                    type: "boolean",
                    default: true,
                    description:
                        "If true (default), slash-commands are dispatched as " +
                        "client-side ChatTriggers commands (resolved by CT/the " +
                        "client and never sent to the server). Set false ONLY " +
                        "when you specifically need the command to reach the " +
                        "Hypixel/Housing server — almost always leave true.",
                },
            },
            required: ["command"],
        },
    },
    {
        name: "htsw_read_chat",
        description:
            "Read recent chat lines the in-game module has forwarded to the " +
            "bridge (server/Hypixel chat, other players, your own public messages " +
            "— NOT the module's own client-side prints). Returns up to `limit` " +
            "most recent lines.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
                since_ms: {
                    type: "integer",
                    description:
                        "Only return lines with ts >= this unix-ms value. Useful " +
                        "after queuing a command: capture Date.now() before, then " +
                        "filter.",
                },
            },
        },
    },
    {
        name: "htsw_clear_chat",
        description: "Clear the bridge's shared chat ring buffer.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "htsw_status",
        description:
            "Report bridge status: whether this session hosts the bridge or is a " +
            "client of another session's host, plus queued commands, buffered " +
            "chat lines, and how long ago the in-game module last polled.",
        inputSchema: { type: "object", properties: {} },
    },
];

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

function unreachable(err) {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text:
                    `bridge not reachable on 127.0.0.1:${PORT} (${err?.message ?? err}). ` +
                    `No session is hosting it — start/restart a session so one binds the port.`,
            },
        ],
    };
}

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};

    if (name === "htsw_run_command") {
        const command = String(args.command ?? "").trim();
        if (command.length === 0) {
            return {
                isError: true,
                content: [{ type: "text", text: "command must be non-empty" }],
            };
        }
        const clientSide = args.client_side !== false;
        try {
            const { status, json } = await bridgeCall("POST", "/command", { command, clientSide });
            if (status !== 200) {
                return { isError: true, content: [{ type: "text", text: json.error ?? `bridge error ${status}` }] };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `queued #${json.id}: ${command} (clientSide=${clientSide}, queue depth ${json.queued})`,
                    },
                ],
            };
        } catch (e) {
            return unreachable(e);
        }
    }

    if (name === "htsw_read_chat") {
        const limit = Math.min(500, Math.max(1, Number(args.limit ?? 100)));
        const since = Number(args.since_ms ?? 0);
        try {
            const { json } = await bridgeCall("GET", `/chat?limit=${limit}&since=${since}`);
            const lines = Array.isArray(json.lines) ? json.lines : [];
            return {
                content: [
                    {
                        type: "text",
                        text:
                            lines.length === 0
                                ? "(no chat lines)"
                                : lines.map((c) => `[${c.ts}] ${c.line}`).join("\n"),
                    },
                ],
            };
        } catch (e) {
            return unreachable(e);
        }
    }

    if (name === "htsw_clear_chat") {
        try {
            await bridgeCall("POST", "/clear");
            return { content: [{ type: "text", text: "chat buffer cleared" }] };
        } catch (e) {
            return unreachable(e);
        }
    }

    if (name === "htsw_status") {
        try {
            const { json } = await bridgeCall("GET", "/status");
            return {
                content: [
                    {
                        type: "text",
                        text: [
                            `this session: ${hosting ? "hosting the bridge" : "client (another session hosts the bridge)"}`,
                            `port: ${PORT}`,
                            `queued commands: ${json.queued}`,
                            `buffered chat lines: ${json.buffered}`,
                            `last in-game poll: ${json.lastPollMs == null ? "never" : json.lastPollMs + "ms ago"}`,
                        ].join("\n"),
                    },
                ],
            };
        } catch (e) {
            return {
                content: [
                    {
                        type: "text",
                        text: [
                            `this session: ${hosting ? "binding…" : "client"}`,
                            `bridge on 127.0.0.1:${PORT} is NOT reachable — no session is hosting it yet.`,
                            `(${e?.message ?? e})`,
                        ].join("\n"),
                    },
                ],
            };
        }
    }

    return {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${name}` }],
    };
});

const transport = new StdioServerTransport();
await mcp.connect(transport);
