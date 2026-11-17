import { WebSocketServer } from 'ws'
import type { AddressInfo } from 'node:net'
import { logger } from '../log.js'
import type { Identity } from '../identity.js'
import type { PeerStore } from '../peers.js'
import { MeshConnection } from './connection.js'
import { acceptHandshake } from './handshake.js'

const log = logger('mesh-server')

export class MeshServer {
  private wss?: WebSocketServer

  constructor(
    private readonly identity: Identity,
    private readonly peers: PeerStore,
    private readonly onConnection: (connection: MeshConnection) => void,
  ) {}

  start(bind: string, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: bind, port })
      this.wss = wss
      wss.on('listening', () => {
        const address = wss.address() as AddressInfo
        log.info(`listening on ${bind}:${address.port}`)
        resolve(address.port)
      })
      wss.on('error', (error) => {
        log.error(`server error: ${String(error)}`)
        reject(error)
      })
      wss.on('connection', (ws, request) => {
        const remote = request.socket.remoteAddress ?? 'unknown'
        acceptHandshake(ws, this.identity, this.peers)
          .then(({ peer, keys }) => {
            log.info(`inbound mesh link from ${peer.name} (${peer.deviceId}) at ${remote}`)
            const connection = new MeshConnection(ws, peer, keys, false)
            this.onConnection(connection)
          })
          .catch((error: unknown) => {
            log.warn(`rejected inbound link from ${remote}: ${String(error)}`)
            try {
              ws.close()
            } catch {
              // ignore
            }
          })
      })
    })
  }

  close(): void {
    this.wss?.close()
    this.wss = undefined
  }
}
