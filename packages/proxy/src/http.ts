import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FiksProxy } from './proxy.ts';

/** Serves the proxy over Streamable HTTP at `/mcp` (stateless: one MCP server per request). */
export async function listenHttp(
  proxy: FiksProxy,
  port = 0,
): Promise<{ url: string; server: HttpServer; close(): Promise<void> }> {
  const http = createServer(async (req, res) => {
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end();
      return;
    }
    const server = proxy.createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((r) => http.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
    server: http,
    close: () =>
      new Promise((r) => {
        http.closeAllConnections();
        http.close(() => r());
      }),
  };
}
