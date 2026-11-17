import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ApprovalOption, SessionEvent, TaskSpec } from '@dsh-mesh/protocol'
import { logger } from '../log.js'
import type { AdapterHooks, HarnessAdapter, TaskHandle } from './types.js'

const log = logger('acp')

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer?: NodeJS.Timeout
}

type JsonRpc = {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

function contentText(content: unknown): string | undefined {
  if (content == null) return undefined
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content.map(contentText).filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join('') : undefined
  }
  if (typeof content === 'object') {
    const value = content as Record<string, unknown>
    if (value.type === 'text' && typeof value.text === 'string') return value.text
    if (value.type === 'content') return contentText(value.content)
    if (value.type === 'diff') {
      return [value.path, value.oldText, value.newText].filter(Boolean).join('\n')
    }
  }
  return undefined
}

type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'
const TOOL_STATUS = new Set<ToolStatus>(['pending', 'in_progress', 'completed', 'failed'])
function mapStatus(value: unknown): ToolStatus {
  return typeof value === 'string' && TOOL_STATUS.has(value as ToolStatus)
    ? (value as ToolStatus)
    : 'in_progress'
}

class AcpProcess {
  private child?: ChildProcessWithoutNullStreams
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private notificationHandlers: ((method: string, params: unknown) => void)[] = []
  private requestHandler?: (method: string, params: unknown) => Promise<unknown>
  private closed = false

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly cwd: string,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      child.once('error', (error) => {
        this.failAll(error)
        reject(error)
      })
      child.once('spawn', () => resolve())
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => this.onStdout(chunk))
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        const text = chunk.trim()
        if (text) log.debug(`stderr: ${text}`)
      })
      child.on('exit', (code, signal) => {
        this.closed = true
        const error = new Error(`agent exited (code=${String(code)} signal=${String(signal)})`)
        this.failAll(error)
        log.info(`agent exited code=${String(code)} signal=${String(signal)}`)
      })
    })
  }

  request(method: string, params: unknown, timeoutMs = 0): Promise<unknown> {
    if (this.closed || !this.child) return Promise.reject(new Error('agent is not running'))
    const id = this.nextId++
    const payload: JsonRpc = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      const entry: PendingRequest = { resolve, reject }
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(`${method} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }
      this.pending.set(id, entry)
      this.child?.stdin.write(JSON.stringify(payload) + '\n')
    })
  }

  notify(method: string, params: unknown): void {
    if (this.closed || !this.child) return
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandlers.push(handler)
  }

  onRequest(handler: (method: string, params: unknown) => Promise<unknown>): void {
    this.requestHandler = handler
  }

  async dispose(): Promise<void> {
    if (!this.child || this.closed) return
    const child = this.child
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.stdin.end()
      child.kill('SIGTERM')
    })
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.handleLine(line)
      index = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpc
    try {
      message = JSON.parse(line) as JsonRpc
    } catch {
      log.debug(`unparseable agent output: ${line.slice(0, 200)}`)
      return
    }
    if (message.id != null && message.method) {
      void this.handleAgentRequest(message)
      return
    }
    if (message.id != null) {
      const id = Number(message.id)
      const entry = this.pending.get(id)
      if (!entry) return
      this.pending.delete(id)
      if (entry.timer) clearTimeout(entry.timer)
      if (message.error) {
        entry.reject(new Error(message.error.message ?? 'agent request failed'))
      } else {
        entry.resolve(message.result)
      }
      return
    }
    if (message.method) {
      for (const handler of this.notificationHandlers) handler(message.method, message.params)
    }
  }

  private async handleAgentRequest(message: JsonRpc): Promise<void> {
    const reply = (payload: JsonRpc) => {
      this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\n')
    }
    try {
      if (!this.requestHandler) throw new Error('no request handler')
      const result = await this.requestHandler(message.method ?? '', message.params)
      reply({ id: message.id, result })
    } catch (error) {
      reply({
        id: message.id,
        error: { code: -32601, message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }
}

export class AcpAdapter implements HarnessAdapter {
  constructor(
    readonly kind: string,
    private readonly command: string,
    private readonly args: string[],
  ) {}

  async start(spec: TaskSpec, hooks: AdapterHooks): Promise<TaskHandle> {
    const proc = new AcpProcess(this.command, this.args, spec.cwd)
    await proc.start()
    await proc.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, 30000)
    const created = (await proc.request('session/new', { cwd: spec.cwd, mcpServers: [] }, 90000)) as {
      sessionId?: string
    }
    const sessionId = created.sessionId
    if (!sessionId) throw new Error('agent did not return a session id')
    log.info(`session ${sessionId} started via ${this.kind}`)

    const toolTitles = new Map<string, string>()
    proc.onNotification((method, params) => {
      if (method !== 'session/update') return
      const payload = params as { sessionId?: string; update?: Record<string, unknown> }
      if (payload.sessionId !== sessionId || !payload.update) return
      this.mapUpdate(payload.update, hooks, toolTitles)
    })

    proc.onRequest(async (method, params) => {
      if (method !== 'session/request_permission') {
        throw new Error(`unsupported agent request ${method}`)
      }
      const payload = params as {
        toolCall?: { title?: string; toolCallId?: string }
        options?: ApprovalOption[]
      }
      const options = (payload.options ?? []).map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      }))
      const chosen = await hooks.onApproval({
        title: payload.toolCall?.title ?? 'Permission required',
        options,
      })
      return chosen
        ? { outcome: { outcome: 'selected', optionId: chosen } }
        : { outcome: { outcome: 'cancelled' } }
    })

    return {
      prompt: async (text: string) => {
        const result = (await proc.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text }],
        })) as { stopReason?: string }
        return result.stopReason
      },
      cancel: () => proc.notify('session/cancel', { sessionId }),
      close: async () => {
        try {
          await proc.request('session/close', { sessionId }, 15000)
        } catch (error) {
          log.debug(`session/close failed: ${String(error)}`)
        }
        await proc.dispose()
      },
    }
  }

  private mapUpdate(
    update: Record<string, unknown>,
    hooks: AdapterHooks,
    toolTitles: Map<string, string>,
  ): void {
    const at = Date.now()
    const kind = update.sessionUpdate
    if (typeof kind !== 'string') return
    switch (kind) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk':
      case 'user_message_chunk': {
        const text = contentText(update.content)
        if (!text) return
        const eventKind = kind === 'agent_thought_chunk' ? 'thought' : kind === 'user_message_chunk' ? 'user' : 'message'
        hooks.onEvent({ kind: eventKind, text, at } as SessionEvent)
        return
      }
      case 'tool_call':
      case 'tool_call_update': {
        const callId = typeof update.toolCallId === 'string' ? update.toolCallId : 'unknown'
        const explicit = typeof update.title === 'string' ? update.title : undefined
        if (explicit) toolTitles.set(callId, explicit)
        const title = explicit ?? toolTitles.get(callId) ?? String(update.kind ?? 'tool')
        hooks.onEvent({
          kind: 'tool',
          callId,
          title,
          status: mapStatus(update.status),
          detail: contentText(update.content),
          at,
        })
        return
      }
      case 'config_option_update': {
        hooks.onEvent({ kind: 'config', model: typeof update.model === 'string' ? update.model : undefined, at })
        return
      }
      case 'usage_update': {
        hooks.onEvent({
          kind: 'context',
          used: typeof update.used === 'number' ? update.used : undefined,
          size: typeof update.size === 'number' ? update.size : undefined,
          at,
        })
        return
      }
      default:
        return
    }
  }
}
