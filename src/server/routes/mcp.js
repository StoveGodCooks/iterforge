/**
 * mcp.js — SSE transport route for the Inter-Forge MCP server.
 *
 * GET  /mcp/sse      — establish SSE stream (MCP client connects here)
 * POST /mcp/message  — receive JSON-RPC messages from MCP client
 */

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from '../../mcp/tools.js';
import express from 'express';

const router = express.Router();

// Map of sessionId -> SSEServerTransport (one entry per active MCP client)
const transports = new Map();

// GET /mcp/sse — client opens this to start an SSE session
router.get('/sse', async (req, res) => {
  try {
    const transport = new SSEServerTransport('/mcp/message', res);
    const server    = createMcpServer();

    transports.set(transport.sessionId, transport);

    res.on('close', () => {
      transports.delete(transport.sessionId);
    });

    await server.connect(transport);
  } catch (err) {
    console.error('[MCP SSE] Connection error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// POST /mcp/message — client posts JSON-RPC messages here
router.post('/message', async (req, res) => {
  try {
    const sessionId  = req.query.sessionId;
    const transport  = transports.get(sessionId);

    if (!transport) {
      return res.status(404).json({ error: `MCP session not found: ${sessionId}` });
    }

    await transport.handlePostMessage(req, res);
  } catch (err) {
    console.error('[MCP SSE] Message handler error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

export default router;
