// Build-time stub. When HTSW_MCP_ENABLED is not set in .env, vite.config.ts aliases
// imports of "./mcp/bridge" to this file so the real bridge — including its HTTP/IO code,
// daemon thread machinery, and any mention of the MCP server — is never included in the
// emitted bundle.
export function initMcpBridge(): void {
    /* MCP bridge disabled at build time */
}
