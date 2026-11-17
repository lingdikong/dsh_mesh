import { EventEmitter } from 'node:events'
import type WebSocket from 'ws'
import { openSealed, seal, type MeshMessage, type SessionKeys } from '@dsh-mesh/protocol'
import type { PeerSide } from './handshake.js'

export class MeshConnection extends EventEmitter {
  private closed = false

  constructor(
    readonly ws: WebSocket,
    readonly peer: PeerSide,
    private readonly keys: SessionKeys,
    readonly outbound: boolean,
  ) {
    super()
    ws.on('message', (data, isBinary) => this.onData(data, isBinary))
    ws.on('close', () => this.markClosed())
    ws.on('error', (err) => {
      if (!this.closed) this.emit('error', err)
    })
  }

  get isOpen(): boolean {
    return !this.closed && this.ws.readyState === 1
  }

  send(message: MeshMessage): boolean {
    if (!this.isOpen) return false
    const key = this.outbound ? this.keys.c2s : this.keys.s2c
    this.ws.send(seal(key, Buffer.from(JSON.stringify(message))), { binary: true })
    return true
  }

  close(): void {
    try {
      this.ws.close()
    } catch {
      // already gone
    }
    this.markClosed()
  }

  private onData(data: WebSocket.RawData, isBinary: boolean): void {
    if (!isBinary) return
    try {
      const key = this.outbound ? this.keys.s2c : this.keys.c2s
      const plain = openSealed(key, data as Buffer)
      const message = JSON.parse(plain.toString('utf8')) as MeshMessage
      this.emit('message', message)
    } catch (error) {
      this.emit('error', error)
    }
  }

  private markClosed(): void {
    if (this.closed) return
    this.closed = true
    this.emit('close')
  }
}
