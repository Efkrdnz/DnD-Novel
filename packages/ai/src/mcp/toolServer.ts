import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { messageOf } from '../fallback'
import type { CommandSession } from '../turn/session'
import { gmTools } from '../turn/tools'

// The GM's tools for the CLIs (Claude Code, Codex): a local MCP server for one turn attempt. It listens on
// 127.0.0.1 only, under a random secret path, refuses browsers (any Origin) and other hosts, and runs every call
// through the same CommandSession as native tools: engine validation, roll handling, events.

const MAX_BODY_BYTES = 1_000_000

/** Follows a tool result that rolled dice, so the model narrates the outcome instead of asking again. */
export const ROLLED_NOTE = 'The dice have been rolled; the result is above. Narrate the outcome now and do not ask for this roll again.'

export interface GmToolServer {
  /** Give this to the CLI; it contains the secret. */
  url: string
  /** Whether a client has connected (an MCP `initialize` arrived). */
  connected: () => boolean
  close: () => Promise<void>
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined)
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function mcpServerFor(session: CommandSession): Server {
  const tools = gmTools(session)
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const server = new Server({ name: 'dnd', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as { type: 'object' } })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name)
    if (!tool) return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool "${request.params.name}"` }) }], isError: true }
    try {
      const result = await tool.execute(request.params.arguments ?? {})
      const content = [{ type: 'text' as const, text: JSON.stringify(result.reply) }]
      return { content: result.roll ? [...content, { type: 'text' as const, text: ROLLED_NOTE }] : content, isError: !result.ok }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: messageOf(err) }) }], isError: true }
    }
  })
  return server
}

const send = (res: ServerResponse, status: number, text: string) => {
  if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain' }).end(text)
}

/** Starts the tool server for one attempt; close it when the attempt ends. */
export async function startGmToolServer(session: CommandSession): Promise<GmToolServer> {
  const path = `/mcp/${randomBytes(32).toString('hex')}`
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>()
  let connected = false
  let host = ''

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== path) return send(res, 404, 'Not found')
    if (req.headers.origin !== undefined) return send(res, 403, 'Forbidden')
    if (req.headers.host !== host) return send(res, 403, 'Forbidden')

    const sessionId = req.headers['mcp-session-id']
    const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
    if (existing) return existing.transport.handleRequest(req, res)

    if (req.method !== 'POST') return send(res, 400, 'No session')
    const body = await readBody(req)
    if (!isInitializeRequest(body)) return send(res, 400, 'No session')

    const server = mcpServerFor(session)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server })
        connected = true
      },
    })
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId)
    }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  const http = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => send(res, 400, messageOf(err)))
  })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', resolve)
  })
  const { port } = http.address() as AddressInfo
  host = `127.0.0.1:${port}`

  return {
    url: `http://${host}${path}`,
    connected: () => connected,
    close: async () => {
      await Promise.allSettled([...sessions.values()].map(({ server }) => server.close()))
      sessions.clear()
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
