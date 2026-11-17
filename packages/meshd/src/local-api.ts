import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import type {
  ApprovalRequest,
  DeviceInfo,
  HarnessKind,
  LocalClientMessage,
  LocalServerMessage,
  TaskSummary,
} from '@dsh-mesh/protocol'
import type { StoredEvent } from './store.js'
import type { MeshPaths } from './paths.js'
import { logger } from './log.js'

const log = logger('local-api')
const VERSION = '0.1.0'
const AUTH_TIMEOUT = 5000

export interface CreateTaskInput {
  target: string
  cwd: string
  prompt: string
  harness?: HarnessKind
  model?: string
  approvalPolicy?: 'ask' | 'never'
}

export interface LocalApiHost {
  deviceInfo(): DeviceInfo
  devices(): DeviceInfo[]
  tasks(): TaskSummary[]
  taskEvents(taskId: string, from?: number): StoredEvent[]
  pendingApprovals(): ApprovalRequest[]
  createTask(input: CreateTaskInput): Promise<{ taskId: string }>
  inputTask(taskId: string, text: string): void
  cancelTask(taskId: string): void
  respondApproval(approvalId: string, optionId: string): { ok: boolean; message?: string }
  createPairing(ttlMs?: number): { link: string; code: string; expiresAt: number }
  acceptPairing(link: string): { deviceId: string; name: string }
  syncProfile(): void
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

interface Client {
  socket: WebSocket
  authenticated: boolean
}

export class LocalApi {
  private server?: http.Server
  private wss?: WebSocketServer
  private clients = new Set<Client>()

  constructor(
    private readonly paths: MeshPaths,
    private readonly token: string,
    private readonly host: LocalApiHost,
  ) {}

  start(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => this.onHttp(request, response))
      this.server = server
      const wss = new WebSocketServer({ noServer: true })
      this.wss = wss
      server.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
      })
      wss.on('connection', (socket) => this.onSocket(socket))
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        const address = server.address() as AddressInfo
        log.info(`panel API on 127.0.0.1:${address.port}`)
        resolve(address.port)
      })
    })
  }

  broadcast(message: LocalServerMessage): void {
    const payload = JSON.stringify(message)
    for (const client of this.clients) {
      if (!client.authenticated || client.socket.readyState !== 1) continue
      try {
        client.socket.send(payload)
      } catch {
        // dropped on close
      }
    }
  }

  close(): void {
    for (const client of this.clients) client.socket.close()
    this.clients.clear()
    this.wss?.close()
    this.server?.close()
    this.server = undefined
  }

  private onHttp(request: http.IncomingMessage, response: http.ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const header = request.headers.authorization ?? ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    const token = bearer || (url.searchParams.get('token') ?? '')
    if (!safeEqual(token, this.token)) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    if (url.pathname === '/health') {
      this.json(response, 200, {
        ok: true,
        version: VERSION,
        device: this.host.deviceInfo(),
        devices: this.host.devices(),
        tasks: this.host.tasks().length,
        approvals: this.host.pendingApprovals().length,
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/snapshot') {
      const taskId = url.searchParams.get('taskId') ?? undefined
      const from = Number(url.searchParams.get('from') ?? '1')
      this.json(response, 200, {
        device: this.host.deviceInfo(),
        devices: this.host.devices(),
        tasks: this.host.tasks(),
        approvals: this.host.pendingApprovals(),
        events: taskId ? this.host.taskEvents(taskId, Number.isFinite(from) ? from : 1) : [],
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/devices') {
      this.json(response, 200, { devices: this.host.devices() })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/tasks') {
      this.json(response, 200, { tasks: this.host.tasks() })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/approvals') {
      this.json(response, 200, { approvals: this.host.pendingApprovals() })
      return
    }
    if (request.method === 'POST') {
      this.readJson(request)
        .then((body) => this.handleHttpAction(url, body, response))
        .catch((error: unknown) => {
          this.json(response, 400, {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      return
    }
    this.json(response, 404, { error: 'not found' })
  }

  private async handleHttpAction(
    url: URL,
    body: Record<string, unknown>,
    response: http.ServerResponse,
  ): Promise<void> {
    const path = url.pathname
    if (path === '/api/tasks') {
      const created = await this.host.createTask({
        target: String(body.target ?? ''),
        cwd: String(body.cwd ?? ''),
        prompt: String(body.prompt ?? ''),
        harness: body.harness as CreateTaskInput['harness'],
        model: typeof body.model === 'string' ? body.model : undefined,
        approvalPolicy: body.approvalPolicy === 'never' ? 'never' : 'ask',
      })
      this.json(response, 200, created)
      return
    }
    const input = /^\/api\/tasks\/([^/]+)\/input$/.exec(path)
    if (input) {
      this.host.inputTask(decodeURIComponent(input[1]!), String(body.text ?? ''))
      this.json(response, 200, { ok: true })
      return
    }
    const cancel = /^\/api\/tasks\/([^/]+)\/cancel$/.exec(path)
    if (cancel) {
      this.host.cancelTask(decodeURIComponent(cancel[1]!))
      this.json(response, 200, { ok: true })
      return
    }
    const respond = /^\/api\/approvals\/([^/]+)\/respond$/.exec(path)
    if (respond) {
      const result = this.host.respondApproval(decodeURIComponent(respond[1]!), String(body.optionId ?? ''))
      this.json(response, result.ok ? 200 : 409, result)
      return
    }
    if (path === '/api/pair/create') {
      this.json(response, 200, this.host.createPairing(Number(body.ttlMs) || undefined))
      return
    }
    if (path === '/api/pair/accept') {
      this.json(response, 200, this.host.acceptPairing(String(body.link ?? '')))
      return
    }
    if (path === '/api/profile/sync') {
      this.host.syncProfile()
      this.json(response, 200, { ok: true })
      return
    }
    this.json(response, 404, { error: 'not found' })
  }

  private readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      request.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1_000_000) {
          reject(new Error('request body too large'))
          request.destroy()
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        if (!text) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(text) as Record<string, unknown>)
        } catch {
          reject(new Error('malformed JSON body'))
        }
      })
      request.on('error', reject)
    })
  }

  private json(response: http.ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  private onSocket(socket: WebSocket): void {
    const client: Client = { socket, authenticated: false }
    this.clients.add(client)
    const timer = setTimeout(() => {
      if (!client.authenticated) socket.close()
    }, AUTH_TIMEOUT)
    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      let message: LocalClientMessage
      try {
        message = JSON.parse(data.toString()) as LocalClientMessage
      } catch {
        this.send(client, { t: 'error', code: 'bad-json', message: 'malformed frame' })
        return
      }
      if (!client.authenticated) {
        if (message.t !== 'hello' || !safeEqual(message.token, this.token)) {
          this.send(client, { t: 'error', code: 'unauthorized', message: 'bad panel token' })
          socket.close()
          return
        }
        client.authenticated = true
        clearTimeout(timer)
        this.send(client, { t: 'hello', device: this.host.deviceInfo(), version: VERSION })
        return
      }
      void this.handle(client, message)
    })
    socket.on('close', () => {
      clearTimeout(timer)
      this.clients.delete(client)
    })
  }

  private async handle(client: Client, message: LocalClientMessage): Promise<void> {
    try {
      switch (message.t) {
        case 'hello':
          return
        case 'status':
          this.send(client, { t: 'ok', op: 'status', value: this.host.deviceInfo() })
          return
        case 'devices/list':
          this.send(client, { t: 'devices', devices: this.host.devices() })
          return
        case 'tasks/list':
          this.send(client, { t: 'tasks', tasks: this.host.tasks() })
          return
        case 'task/create': {
          const created = await this.host.createTask({
            target: message.target,
            cwd: message.cwd,
            prompt: message.prompt,
            harness: message.harness,
            model: message.model,
            approvalPolicy: message.approvalPolicy,
          })
          this.send(client, { t: 'ok', op: 'task/create', value: created })
          return
        }
        case 'task/attach': {
          const events = this.host.taskEvents(message.taskId, message.from ?? 1)
          for (const entry of events) {
            this.send(client, { t: 'event', taskId: message.taskId, seq: entry.seq, event: entry.event })
          }
          this.send(client, { t: 'ok', op: 'task/attach', value: { taskId: message.taskId, lastSeq: events.at(-1)?.seq ?? 0 } })
          return
        }
        case 'task/input':
          this.host.inputTask(message.taskId, message.text)
          this.send(client, { t: 'ok', op: 'task/input' })
          return
        case 'task/cancel':
          this.host.cancelTask(message.taskId)
          this.send(client, { t: 'ok', op: 'task/cancel' })
          return
        case 'approvals/list':
          this.send(client, { t: 'approvals', approvals: this.host.pendingApprovals() })
          return
        case 'approval/respond': {
          const result = this.host.respondApproval(message.approvalId, message.optionId)
          if (result.ok) this.send(client, { t: 'ok', op: 'approval/respond' })
          else this.send(client, { t: 'error', code: 'approval', message: result.message ?? 'failed' })
          return
        }
        case 'pair/create': {
          const pairing = this.host.createPairing(message.ttlMs)
          this.send(client, { t: 'pairing', ...pairing })
          return
        }
        case 'pair/accept': {
          const peer = this.host.acceptPairing(message.link)
          this.send(client, { t: 'ok', op: 'pair/accept', value: peer })
          return
        }
        case 'profile/sync': {
          this.host.syncProfile()
          this.send(client, { t: 'ok', op: 'profile/sync' })
          return
        }
        default:
          this.send(client, { t: 'error', code: 'unknown-op', message: 'unsupported command' })
      }
    } catch (error) {
      this.send(client, {
        t: 'error',
        code: 'op-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private send(client: Client, message: LocalServerMessage): void {
    if (client.socket.readyState !== 1) return
    try {
      client.socket.send(JSON.stringify(message))
    } catch {
      // ignore
    }
  }
}
