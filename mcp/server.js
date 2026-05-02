#!/usr/bin/env node
/**
 * HTSW MCP bridge server.
 *
 * Two interfaces:
 *   - MCP (stdio): exposes tools to the LLM (Claude Code).
 *   - HTTP (localhost:PORT): the ChatTriggers module polls this for queued
 *     commands and POSTs chat lines back.
 *
 * State is fully in-memory. Restart the server to clear it.
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
    try {
        if (req.method === "GET" && req.url === "/health") {
            res.end(JSON.stringify({ ok: true, queued: commandQueue.length }));
            return;
        }
        if (req.method === "GET" && req.url === "/poll") {
            lastClientPollAt = Date.now();
            const drained = commandQueue.splice(0, commandQueue.length);
            res.end(JSON.stringify({ commands: drained }));
            return;
        }
        if (req.method === "POST" && req.url === "/chat") {
            const body = await readJsonBody(req);
            const lines = Array.isArray(body.lines) ? body.lines : [];
            for (const line of lines) pushChat(line);
            res.end(JSON.stringify({ ok: true, stored: chatBuffer.length }));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
});

let httpListening = false;
httpServer.on("listening", () => {
    httpListening = true;
    process.stderr.write(`[htsw-mcp] HTTP bridge listening on 127.0.0.1:${PORT}\n`);
});
httpServer.on("error", (err) => {
    // Don't crash MCP stdio if the bridge port is taken (orphaned previous
    // instance, etc.) — log and retry every 5s so the bridge self-heals once
    // the port is free.
    httpListening = false;
    if (err?.code === "EADDRINUSE") {
        process.stderr.write(
            `[htsw-mcp] port ${PORT} busy; retrying in 5s\n`
        );
        setTimeout(() => httpServer.listen(PORT, "127.0.0.1"), 5000);
        return;
    }
    process.stderr.write(
        `[htsw-mcp] HTTP listen error: ${err?.message ?? err}\n`
    );
});
httpServer.listen(PORT, "127.0.0.1");

const mcp = new Server(
    { name: "htsw-bridge", version: "0.1.0" },
    { capabilities: { tools: {} } }
);

const TOOLS = [
    {
        name: "htsw_run_command",
        description:
            "Queue a chat command (or plain message) for the HTSW ChatTriggers " +
            "module to run in Minecraft. Include the leading slash for commands. " +
            "Returns immediately — call htsw_read_chat after a short delay to see " +
            "the result. Requires the module to be running in-game with " +
            "HTSW_MCP_ENABLED=true.",
        inputSchema: {
            type: "object",
            properties: {
                command: {
                    type: "string",
                    description: "e.g. '/htsw gui' or '/htsw gui debug 30'",
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
            "Read recent chat lines that the in-game module has forwarded to the " +
            "bridge. Returns up to `limit` most recent lines.",
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
        description: "Clear the bridge's chat ring buffer.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "htsw_status",
        description:
            "Report bridge status: HTTP port, queued commands, buffered chat " +
            "lines, and how long ago the in-game module last polled.",
        inputSchema: { type: "object", properties: {} },
    },
];

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

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
        const clientSide = args.client_side !== false; // default true
        const id = nextCommandId++;
        commandQueue.push({ id, command, clientSide });
        return {
            content: [
                {
                    type: "text",
                    text:
                        `queued #${id}: ${command} ` +
                        `(clientSide=${clientSide}, queue depth ${commandQueue.length})`,
                },
            ],
        };
    }

    if (name === "htsw_read_chat") {
        const limit = Math.min(500, Math.max(1, Number(args.limit ?? 100)));
        const since = Number(args.since_ms ?? 0);
        const filtered = since > 0 ? chatBuffer.filter((c) => c.ts >= since) : chatBuffer;
        const slice = filtered.slice(-limit);
        return {
            content: [
                {
                    type: "text",
                    text:
                        slice.length === 0
                            ? "(no chat lines)"
                            : slice.map((c) => `[${c.ts}] ${c.line}`).join("\n"),
                },
            ],
        };
    }

    if (name === "htsw_clear_chat") {
        chatBuffer.length = 0;
        return { content: [{ type: "text", text: "chat buffer cleared" }] };
    }

    if (name === "htsw_status") {
        const sinceLastPoll =
            lastClientPollAt === 0 ? "never" : `${Date.now() - lastClientPollAt}ms ago`;
        return {
            content: [
                {
                    type: "text",
                    text: [
                        `port: ${PORT} (${httpListening ? "listening" : "NOT BOUND"})`,
                        `queued commands: ${commandQueue.length}`,
                        `buffered chat lines: ${chatBuffer.length}`,
                        `last in-game poll: ${sinceLastPoll}`,
                    ].join("\n"),
                },
            ],
        };
    }

    return {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${name}` }],
    };
});

const transport = new StdioServerTransport();
await mcp.connect(transport);
