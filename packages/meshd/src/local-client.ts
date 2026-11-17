import fs from 'node:fs'
import WebSocket from 'ws'
import type { LocalClientMessage, LocalServerMessage } from '@dsh-mesh/protocol'
import { readJson } from './paths.js'
import type { MeshPaths } from './paths.js'

function panelPort(paths: MeshPaths): number {
  const config = readJson<{ panelPort?: number }>(paths.config)
  return config?.panelPort ?? 47822
}

export class LocalClient {
  private queue: LocalServerMessage[] = []
  private waiters: { predicate: (message: LocalServerMessage) => boolean; resolve: (message: LocalServerMessage) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }[] = []
  private closed = false

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => this.onMessage(data.toString()))
    socket.on('close', () => {
      this.closed = true
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error('local connection closed'))
      }
    })
  }

  static async connect(paths: MeshPaths): Promise<LocalClient> {
    const token = fs.readFileSync(paths.panelToken, 'utf8').trim()
    const url = `ws://127.0.0.1:${panelPort(paths)}`
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: 4000 })
      ws.once('open', () => resolve(ws))
      ws.once('error', (error) => reject(new Error(`cannot reach meshd at ${url}: ${error.message}`)))
    })
    const client = new LocalClient(socket)
    client.send({ t: 'hello', token })
    await client.next((message) => message.t === 'hello' || message.t === 'error', 5000)
    return client
  }

  send(message: LocalClientMessage): void {
    this.socket.send(JSON.stringify(message))
  }

  next(predicate: (message: LocalServerMessage) => boolean, timeoutMs = 30000): Promise<LocalServerMessage> {
    const existing = this.queue.findIndex(predicate)
    if (existing >= 0) {
      const [message] = this.queue.splice(existing, 1)
      return Promise.resolve(message!)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry.timer !== timer)
        reject(new Error('timed out waiting for meshd'))
      }, timeoutMs)
      this.waiters.push({ predicate, resolve, reject, timer })
    })
  }

  onEvent(handler: (message: LocalServerMessage) => void): () => void {
    const listener = (message: LocalServerMessage) => handler(message)
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.socket.close()
  }

  private listeners = new Set<(message: LocalServerMessage) => void>()

  private onMessage(text: string): void {
    let message: LocalServerMessage
    try {
      message = JSON.parse(text) as LocalServerMessage
    } catch {
      return
    }
    for (const listener of this.listeners) listener(message)
    const index = this.waiters.findIndex((waiter) => waiter.predicate(message))
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1)
      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      }
      return
    }
    this.queue.push(message)
    if (this.queue.length > 500) this.queue.shift()
  }
}
