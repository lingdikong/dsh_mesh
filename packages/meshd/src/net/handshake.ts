import type WebSocket from 'ws'
import {
  PROTOCOL_VERSION,
  b64u,
  deriveSessionKeys,
  deviceIdOf,
  edSign,
  edVerify,
  fromB64u,
  handshakeTranscript,
  randomNonce,
  x25519Shared,
  type AuthFrame,
  type ChallengeFrame,
  type DeniedFrame,
  type HandshakeSide,
  type HelloFrame,
  type SessionKeys,
} from '@dsh-mesh/protocol'
import type { Identity } from '../identity.js'
import { identityKeys } from '../identity.js'
import type { PeerRecord, PeerStore } from '../peers.js'

const STEP_TIMEOUT = 8000

export interface PeerSide {
  deviceId: string
  name: string
  platform: string
  edPub: string
  xPub: string
}

export interface HandshakeResult {
  peer: PeerSide
  keys: SessionKeys
}

function onceText(ws: WebSocket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('handshake timeout'))
    }, timeoutMs)
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return
      cleanup()
      resolve(data.toString())
    }
    const onClose = () => {
      cleanup()
      reject(new Error('connection closed during handshake'))
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    function cleanup(): void {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('close', onClose)
      ws.off('error', onError)
    }
    ws.on('message', onMessage)
    ws.on('close', onClose)
    ws.on('error', onError)
  })
}

function parse<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('malformed handshake frame')
  }
}

function selfSide(identity: Identity, nonce: string): HandshakeSide {
  return { deviceId: identity.deviceId, edPub: identity.edPub, xPub: identity.xPub, nonce }
}

function peerSide(hello: HelloFrame | ChallengeFrame): HandshakeSide {
  return { deviceId: hello.deviceId, edPub: hello.edPub, xPub: hello.xPub, nonce: hello.nonce }
}

function sessionKeys(identity: Identity, selfNonce: string, peer: HandshakeSide): SessionKeys {
  const keys = identityKeys(identity)
  const shared = x25519Shared(keys.xPriv, fromB64u(peer.xPub))
  // Deterministic on both sides: sort the two nonces before concatenating.
  const salt = Buffer.concat([fromB64u(selfNonce), fromB64u(peer.nonce)].sort(Buffer.compare))
  return deriveSessionKeys(shared, salt)
}

/** Server side: verify the dialer against the paired key, prove our own identity. */
export async function acceptHandshake(
  ws: WebSocket,
  identity: Identity,
  peers: PeerStore,
): Promise<HandshakeResult> {
  const first = parse<HelloFrame | { t: string }>(await onceText(ws, STEP_TIMEOUT))
  if (first.t !== 'hello') throw new Error('expected hello')
  const hello = first as HelloFrame
  if (hello.v !== PROTOCOL_VERSION) throw new Error(`unsupported protocol ${String(hello.v)}`)
  const known = peers.get(hello.deviceId)
  if (!known || known.edPub !== hello.edPub || known.xPub !== hello.xPub) {
    const denied: DeniedFrame = { t: 'denied', reason: 'unknown-device' }
    ws.send(JSON.stringify(denied))
    throw new Error(`unpaired device ${hello.deviceId}`)
  }
  if (deviceIdOf(fromB64u(hello.edPub)) !== hello.deviceId) throw new Error('device id mismatch')

  const keys = identityKeys(identity)
  const nonce = b64u(randomNonce())
  const client = peerSide(hello)
  const server = selfSide(identity, nonce)
  const transcript = handshakeTranscript(client, server)
  const challenge: ChallengeFrame = {
    t: 'challenge',
    v: PROTOCOL_VERSION,
    deviceId: identity.deviceId,
    name: identity.name,
    platform: identity.platform,
    edPub: identity.edPub,
    xPub: identity.xPub,
    nonce,
    sig: b64u(edSign(keys.edPriv, transcript)),
  }
  ws.send(JSON.stringify(challenge))

  const auth = parse<AuthFrame>(await onceText(ws, STEP_TIMEOUT))
  if (auth.t !== 'auth' || auth.deviceId !== hello.deviceId) throw new Error('bad auth frame')
  if (!edVerify(fromB64u(hello.edPub), transcript, fromB64u(auth.sig))) {
    throw new Error('invalid client signature')
  }

  return {
    peer: {
      deviceId: hello.deviceId,
      name: hello.name,
      platform: hello.platform,
      edPub: hello.edPub,
      xPub: hello.xPub,
    },
    keys: sessionKeys(identity, nonce, client),
  }
}

/** Client side: prove who we are, then verify the paired server before trusting it. */
export async function dialHandshake(
  ws: WebSocket,
  identity: Identity,
  peer: PeerRecord,
): Promise<HandshakeResult> {
  const keys = identityKeys(identity)
  const nonce = b64u(randomNonce())
  const hello: HelloFrame = {
    t: 'hello',
    v: PROTOCOL_VERSION,
    deviceId: identity.deviceId,
    name: identity.name,
    platform: identity.platform,
    edPub: identity.edPub,
    xPub: identity.xPub,
    nonce,
  }
  ws.send(JSON.stringify(hello))

  const first = parse<ChallengeFrame | DeniedFrame>(await onceText(ws, STEP_TIMEOUT))
  if (first.t === 'denied') throw new Error(`peer denied pairing: ${first.reason}`)
  if (first.t !== 'challenge') throw new Error('expected challenge')
  if (first.deviceId !== peer.deviceId) throw new Error('peer identity mismatch')
  if (first.edPub !== peer.edPub || first.xPub !== peer.xPub) {
    throw new Error('peer key mismatch — re-pair this device')
  }
  const client = selfSide(identity, nonce)
  const server = peerSide(first)
  const transcript = handshakeTranscript(client, server)
  if (!edVerify(fromB64u(peer.edPub), transcript, fromB64u(first.sig))) {
    throw new Error('invalid server signature')
  }

  const auth: AuthFrame = {
    t: 'auth',
    deviceId: identity.deviceId,
    sig: b64u(edSign(keys.edPriv, transcript)),
  }
  ws.send(JSON.stringify(auth))

  return {
    peer: {
      deviceId: first.deviceId,
      name: first.name,
      platform: first.platform,
      edPub: first.edPub,
      xPub: first.xPub,
    },
    keys: sessionKeys(identity, nonce, server),
  }
}
