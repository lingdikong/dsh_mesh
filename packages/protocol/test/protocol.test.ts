import { describe, expect, it } from 'vitest'
import {
  base32Encode,
  deriveSessionKeys,
  deviceIdOf,
  edSign,
  edVerify,
  encodePairingLink,
  generateEd25519,
  generateX25519,
  handshakeTranscript,
  openSealed,
  parsePairingLink,
  seal,
  x25519Shared,
} from '../src/index.js'

describe('base32', () => {
  it('encodes RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('mzxw6ytboi')
    expect(base32Encode(Buffer.from(''))).toBe('')
  })
})

describe('device identity', () => {
  it('is stable, 26 chars, and differs per key', () => {
    const a = generateEd25519()
    const b = generateEd25519()
    expect(deviceIdOf(a.pub)).toHaveLength(26)
    expect(deviceIdOf(a.pub)).toBe(deviceIdOf(a.pub))
    expect(deviceIdOf(a.pub)).not.toBe(deviceIdOf(b.pub))
  })
})

describe('handshake crypto', () => {
  it('signs and verifies transcripts', () => {
    const a = generateEd25519()
    const b = generateEd25519()
    const transcript = handshakeTranscript(
      { deviceId: deviceIdOf(a.pub), edPub: 'a', xPub: 'a', nonce: 'n1' },
      { deviceId: deviceIdOf(b.pub), edPub: 'b', xPub: 'b', nonce: 'n2' },
    )
    const sig = edSign(a.priv, transcript)
    expect(edVerify(a.pub, transcript, sig)).toBe(true)
    expect(edVerify(b.pub, transcript, sig)).toBe(false)
  })

  it('derives the same directional keys on both sides', () => {
    const a = generateX25519()
    const b = generateX25519()
    const sharedA = x25519Shared(a.priv, b.pub)
    const sharedB = x25519Shared(b.priv, a.pub)
    expect(sharedA.equals(sharedB)).toBe(true)
    const salt = Buffer.from('salt')
    const ka = deriveSessionKeys(sharedA, salt)
    const kb = deriveSessionKeys(sharedB, salt)
    expect(ka.c2s.equals(kb.c2s)).toBe(true)
    expect(ka.s2c.equals(kb.s2c)).toBe(true)
    expect(ka.c2s.equals(ka.s2c)).toBe(false)
  })

  it('seals and opens frames, rejecting tampering', () => {
    const key = Buffer.alloc(32, 7)
    const plain = Buffer.from(JSON.stringify({ t: 'ping', at: 1 }))
    const frame = seal(key, plain)
    expect(openSealed(key, frame).equals(plain)).toBe(true)
    const bad = Buffer.from(frame)
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff
    expect(() => openSealed(key, bad)).toThrow()
  })
})

describe('pairing links', () => {
  it('round-trips', () => {
    const link = encodePairingLink({
      v: 1,
      deviceId: 'dev',
      name: 'MacBook',
      platform: 'darwin',
      edPub: 'ed',
      xPub: 'x',
      addresses: ['10.0.0.2:47821'],
      code: '123456',
      expiresAt: Date.now() + 60_000,
    })
    const parsed = parsePairingLink(link)
    expect(parsed.deviceId).toBe('dev')
    expect(parsed.addresses).toEqual(['10.0.0.2:47821'])
  })
})
