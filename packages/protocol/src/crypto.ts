import crypto from 'node:crypto'
import { base32Encode } from './base32.js'

export interface KeyPairRaw {
  pub: Buffer
  priv: Buffer
}

const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex')
const ED_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex')
const X_SPKI = Buffer.from('302a300506032b656e032100', 'hex')
const X_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')

function rawFromDer(exported: ArrayBuffer | Uint8Array): Buffer {
  const buf = exported instanceof Uint8Array ? Buffer.from(exported) : Buffer.from(new Uint8Array(exported))
  return Buffer.from(buf.subarray(-32))
}

export function generateEd25519(): KeyPairRaw {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  return {
    pub: rawFromDer(publicKey.export({ format: 'der', type: 'spki' })),
    priv: rawFromDer(privateKey.export({ format: 'der', type: 'pkcs8' })),
  }
}

export function generateX25519(): KeyPairRaw {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  return {
    pub: rawFromDer(publicKey.export({ format: 'der', type: 'spki' })),
    priv: rawFromDer(privateKey.export({ format: 'der', type: 'pkcs8' })),
  }
}

export function edSign(privRaw: Uint8Array, message: Uint8Array): Buffer {
  const key = crypto.createPrivateKey({
    key: Buffer.concat([ED_PKCS8, Buffer.from(privRaw)]),
    format: 'der',
    type: 'pkcs8',
  })
  return crypto.sign(null, Buffer.from(message), key)
}

export function edVerify(pubRaw: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED_SPKI, Buffer.from(pubRaw)]),
      format: 'der',
      type: 'spki',
    })
    return crypto.verify(null, Buffer.from(message), key, Buffer.from(signature))
  } catch {
    return false
  }
}

export function x25519Shared(privRaw: Uint8Array, peerPubRaw: Uint8Array): Buffer {
  const priv = crypto.createPrivateKey({
    key: Buffer.concat([X_PKCS8, Buffer.from(privRaw)]),
    format: 'der',
    type: 'pkcs8',
  })
  const pub = crypto.createPublicKey({
    key: Buffer.concat([X_SPKI, Buffer.from(peerPubRaw)]),
    format: 'der',
    type: 'spki',
  })
  return crypto.diffieHellman({ privateKey: priv, publicKey: pub })
}

export interface SessionKeys {
  c2s: Buffer
  s2c: Buffer
}

export function deriveSessionKeys(shared: Buffer, salt: Buffer): SessionKeys {
  const c2s = Buffer.from(
    crypto.hkdfSync('sha256', shared, salt, Buffer.from('dsh-mesh/v1/c2s'), 32),
  )
  const s2c = Buffer.from(
    crypto.hkdfSync('sha256', shared, salt, Buffer.from('dsh-mesh/v1/s2c'), 32),
  )
  return { c2s, s2c }
}

const IV_LEN = 12
const TAG_LEN = 16

/** iv(12) | tag(16) | ciphertext */
export function seal(key: Buffer, plaintext: Uint8Array): Buffer {
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct])
}

export function openSealed(key: Buffer, frame: Uint8Array): Buffer {
  const buf = Buffer.from(frame)
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('frame too short')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

export function sha256(data: Uint8Array): Buffer {
  return crypto.createHash('sha256').update(Buffer.from(data)).digest()
}

export function deviceIdOf(edPub: Uint8Array): string {
  return base32Encode(sha256(edPub)).slice(0, 26)
}

export function randomNonce(bytes = 18): Buffer {
  return crypto.randomBytes(bytes)
}

export function b64u(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64url')
}

export function fromB64u(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}

export interface HandshakeSide {
  deviceId: string
  edPub: string
  xPub: string
  nonce: string
}

/** Bytes both sides sign: identical ordering and separators. */
export function handshakeTranscript(client: HandshakeSide, server: HandshakeSide): Buffer {
  const norm = (s: HandshakeSide) => `${s.deviceId}|${s.edPub}|${s.xPub}|${s.nonce}`
  return Buffer.from(`dsh-mesh/v1|${norm(client)}|${norm(server)}`, 'utf8')
}
