import type { DeviceId } from '@dsh-mesh/protocol'
import { ensureDir, readJson, writeJson, type MeshPaths } from './paths.js'

export interface PeerRecord {
  deviceId: DeviceId
  name: string
  platform: string
  edPub: string
  xPub: string
  addresses: string[]
  addedAt: number
  lastSeen?: number
}

interface PeersFile {
  peers: Record<DeviceId, PeerRecord>
}

export class PeerStore {
  private peers = new Map<DeviceId, PeerRecord>()

  constructor(private readonly paths: MeshPaths) {
    ensureDir(paths.home)
    const file = readJson<PeersFile>(paths.peers)
    for (const [id, record] of Object.entries(file?.peers ?? {})) this.peers.set(id, record)
  }

  list(): PeerRecord[] {
    return [...this.peers.values()]
  }

  get(deviceId: DeviceId): PeerRecord | undefined {
    return this.peers.get(deviceId)
  }

  findByName(name: string): PeerRecord | undefined {
    const needle = name.toLowerCase()
    return this.list().find((p) => p.name.toLowerCase() === needle || p.deviceId === name)
  }

  add(record: Omit<PeerRecord, 'addedAt'> & { addedAt?: number }): PeerRecord {
    const existing = this.peers.get(record.deviceId)
    const merged: PeerRecord = {
      ...existing,
      ...record,
      addedAt: existing?.addedAt ?? record.addedAt ?? Date.now(),
    }
    this.peers.set(merged.deviceId, merged)
    this.flush()
    return merged
  }

  touch(deviceId: DeviceId): void {
    const record = this.peers.get(deviceId)
    if (!record) return
    record.lastSeen = Date.now()
    this.flush()
  }

  remove(deviceId: DeviceId): void {
    this.peers.delete(deviceId)
    this.flush()
  }

  private flush(): void {
    const peers: Record<DeviceId, PeerRecord> = {}
    for (const [id, record] of this.peers) peers[id] = record
    writeJson(this.paths.peers, { peers } satisfies PeersFile)
  }
}
