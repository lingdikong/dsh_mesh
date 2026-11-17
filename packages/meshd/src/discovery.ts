import { Bonjour, type Service } from 'bonjour-service'
import type { DeviceId } from '@dsh-mesh/protocol'
import { logger } from './log.js'

const log = logger('discovery')
export const SERVICE_TYPE = 'dshmesh'

export class Discovery {
  private bonjour?: Bonjour
  private published = false

  constructor(
    private readonly self: { deviceId: DeviceId; name: string; port: number },
    private readonly onAddress: (deviceId: DeviceId, address: string) => void,
  ) {}

  start(): void {
    try {
      const bonjour = new Bonjour()
      this.bonjour = bonjour
      bonjour.publish({
        name: `${this.self.name}-${this.self.deviceId.slice(0, 6)}`,
        type: SERVICE_TYPE,
        port: this.self.port,
        txt: { id: this.self.deviceId, v: '1', name: this.self.name },
      })
      this.published = true
      bonjour.find({ type: SERVICE_TYPE }, (service: Service) => {
        const id = service.txt?.id
        if (typeof id !== 'string' || id === this.self.deviceId) return
        const host = service.referer?.address ?? service.host
        if (!host) return
        const address = `${host}:${service.port}`
        this.onAddress(id, address)
      })
      log.info('mDNS discovery started')
    } catch (error) {
      log.warn(`mDNS unavailable: ${String(error)}`)
    }
  }

  stop(): void {
    try {
      if (this.published) this.bonjour?.unpublishAll()
      this.bonjour?.destroy()
    } catch {
      // ignore
    }
    this.bonjour = undefined
    this.published = false
  }
}
