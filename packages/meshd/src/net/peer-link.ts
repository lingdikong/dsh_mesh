import WebSocket from 'ws'
import type { MeshMessage } from '@dsh-mesh/protocol'
import type { Identity } from '../identity.js'
import type { PeerRecord } from '../peers.js'
import { logger } from '../log.js'
import { MeshConnection } from './connection.js'
import { dialHandshake } from './handshake.js'

const log = logger('peer-link')

export class PeerLink {
  outbound?: MeshConnection
  inbound?: MeshConnection
  private timer?: NodeJS.Timeout
  private backoff = 1000
  private stopped = false
  private dialing = false

  constructor(
    readonly peer: PeerRecord,
    private readonly identity: Identity,
    private readonly onConnection: (connection: MeshConnection) => void,
  ) {}

  get connected(): boolean {
    return Boolean(this.outbound?.isOpen || this.inbound?.isOpen)
  }

  start(): void {
    this.stopped = false
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.outbound?.close()
    this.inbound?.close()
    this.outbound = undefined
    this.inbound = undefined
  }

  accept(connection: MeshConnection): void {
    if (this.inbound?.isOpen) this.inbound.close()
    this.inbound = connection
    connection.on('close', () => {
      if (this.inbound === connection) this.inbound = undefined
    })
    this.onConnection(connection)
  }

  send(message: MeshMessage): boolean {
    const connection = this.outbound?.isOpen
      ? this.outbound
      : this.inbound?.isOpen
        ? this.inbound
        : undefined
    if (!connection) return false
    return connection.send(message)
  }

  private schedule(ms: number): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.dial()
    }, ms)
  }

  private async dial(): Promise<void> {
    if (this.stopped || this.dialing || this.outbound?.isOpen) return
    if (this.peer.addresses.length === 0) {
      this.schedule(30000)
      return
    }
    this.dialing = true
    try {
      let lastError: unknown
      for (const address of this.peer.addresses) {
        try {
          const connection = await this.open(`ws://${address}`)
          if (this.stopped) {
            connection.close()
            return
          }
          if (this.outbound?.isOpen) this.outbound.close()
          this.outbound = connection
          connection.on('close', () => {
            if (this.outbound === connection) {
              this.outbound = undefined
              this.backoff = 1000
              this.schedule(this.backoff)
            }
          })
          this.backoff = 1000
          this.onConnection(connection)
          return
        } catch (error) {
          lastError = error
          log.debug(`dial ${this.peer.name} (${address}) failed: ${String(error)}`)
        }
      }
      throw lastError ?? new Error('no address reachable')
    } catch (error) {
      log.debug(`all addresses for ${this.peer.name} failed: ${String(error)}`)
      this.backoff = Math.min(this.backoff * 2, 30000)
      this.schedule(this.backoff)
    } finally {
      this.dialing = false
    }
  }

  private open(url: string): Promise<MeshConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: 8000 })
      const fail = (error: unknown) => {
        try {
          ws.close()
        } catch {
          // ignore
        }
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      ws.once('error', fail)
      ws.once('open', () => {
        ws.off('error', fail)
        dialHandshake(ws, this.identity, this.peer)
          .then(({ peer, keys }) => resolve(new MeshConnection(ws, peer, keys, true)))
          .catch(fail)
      })
    })
  }
}
