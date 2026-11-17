import os from 'node:os'
import {
  b64u,
  deviceIdOf,
  fromB64u,
  generateEd25519,
  generateX25519,
} from '@dsh-mesh/protocol'
import { ensureDir, readJson, writeJson, type MeshPaths } from './paths.js'

export interface Identity {
  deviceId: string
  name: string
  platform: string
  edPub: string
  edPriv: string
  xPub: string
  xPriv: string
  createdAt: number
}

export function loadOrCreateIdentity(paths: MeshPaths): Identity {
  ensureDir(paths.home)
  const existing = readJson<Identity>(paths.identity)
  if (existing) return existing
  const ed = generateEd25519()
  const x = generateX25519()
  const identity: Identity = {
    deviceId: deviceIdOf(ed.pub),
    name: os.hostname().replace(/\.local$/i, ''),
    platform: process.platform,
    edPub: b64u(ed.pub),
    edPriv: b64u(ed.priv),
    xPub: b64u(x.pub),
    xPriv: b64u(x.priv),
    createdAt: Date.now(),
  }
  writeJson(paths.identity, identity)
  return identity
}

export function identityKeys(identity: Identity) {
  return {
    edPub: fromB64u(identity.edPub),
    edPriv: fromB64u(identity.edPriv),
    xPub: fromB64u(identity.xPub),
    xPriv: fromB64u(identity.xPriv),
  }
}
