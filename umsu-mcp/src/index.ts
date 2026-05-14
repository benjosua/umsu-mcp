import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { createUmsuMcpServer } from './server.ts';

type TransportMode = 'stdio' | 'http';

type CliOptions = {
  transport: TransportMode;
  host: string;
  port: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    transport: 'stdio',
    host: process.env.MCP_HOST ?? '127.0.0.1',
    port: process.env.MCP_PORT ? Number(process.env.MCP_PORT) : 3337,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--transport' && next) {
      if (next === 'stdio' || next === 'http') {
        options.transport = next;
      } else {
        throw new Error(`Unknown transport "${next}".`);
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--transport=')) {
      const mode = arg.slice('--transport='.length);
      if (mode === 'stdio' || mode === 'http') {
        options.transport = mode;
        continue;
      }
      throw new Error(`Unknown transport "${mode}".`);
    }
    if (arg === '--host' && next) {
      options.host = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length);
      continue;
    }
    if (arg === '--port' && next) {
      options.port = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length));
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'UMSU MCP Server',
          '',
          'Usage:',
          '  npm run start:stdio',
          '  npm run start:http',
          '  npm run start -- --transport http --port 3337',
        ].join('\n'),
      );
      process.exit(0);
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid port "${options.port}".`);
  }

  return options;
}

async function startStdio() {
  const server = createUmsuMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('UMSU MCP server listening on stdio');
}

async function startHttp(host: string, port: number) {
  const app = createMcpExpressApp();
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const connectServer = async (transport: StreamableHTTPServerTransport) => {
    const server = createUmsuMcpServer();
    await server.connect(transport);
  };

  const badRequest = (res: Response, message: string) => {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message,
      },
      id: null,
    });
  };

  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionIdHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

      if (sessionId) {
        const existing = transports.get(sessionId);
        if (!existing) {
          badRequest(res, `Unknown session "${sessionId}".`);
          return;
        }

        await existing.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        badRequest(res, 'Expected an initialize request or an existing MCP session id.');
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (createdSessionId) => {
          transports.set(createdSessionId, transport);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };

      await connectServer(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Failed to handle MCP POST request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    if (!sessionId) {
      badRequest(res, 'Missing MCP session id.');
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      badRequest(res, `Unknown session "${sessionId}".`);
      return;
    }

    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    if (!sessionId) {
      badRequest(res, 'Missing MCP session id.');
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      badRequest(res, `Unknown session "${sessionId}".`);
      return;
    }

    await transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const listener = app.listen(port, host, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      console.error(`UMSU MCP server listening on http://${host}:${port}/mcp`);
      resolve();
    });

    listener.on('error', reject);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.transport === 'http') {
    await startHttp(options.host, options.port);
    return;
  }

  await startStdio();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
