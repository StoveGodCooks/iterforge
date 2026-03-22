/**
 * server.js — Stdio MCP transport for CLI / Claude Desktop use.
 *
 * Usage (in claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "iterforge": {
 *         "command": "node",
 *         "args": ["C:/path/to/iterforge/src/mcp/server.js"]
 *       }
 *     }
 *   }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'url';
import { createMcpServer } from './tools.js';

async function main() {
  const server    = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Inter-Forge MCP server running on stdio\n');
}

export async function startMCPServer() {
  return main();
}

// Only start automatically when run directly (node src/mcp/server.js).
// When imported by bin/iterforge.js, startMCPServer() is called explicitly.
const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === (await import('path')).default.resolve(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`Inter-Forge MCP fatal error: ${err.message}\n`);
    process.exit(1);
  });
}
