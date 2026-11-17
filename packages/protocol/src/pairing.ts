export const PAIRING_VERSION = 1

export interface PairingPayload {
  v: typeof PAIRING_VERSION
  deviceId: string
  name: string
  platform: string
  edPub: string
  xPub: string
  addresses: string[]
  code: string
  expiresAt: number
}

export function encodePairingLink(payload: PairingPayload): string {
  return `dsh-mesh://pair/${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`
}

export function parsePairingLink(link: string): PairingPayload {
  const trimmed = link.trim()
  const prefix = 'dsh-mesh://pair/'
  if (!trimmed.startsWith(prefix)) throw new Error('not a dsh-mesh pairing link')
  const json = Buffer.from(trimmed.slice(prefix.length), 'base64url').toString('utf8')
  const parsed = JSON.parse(json) as PairingPayload
  if (parsed.v !== PAIRING_VERSION) throw new Error(`unsupported pairing version ${String(parsed.v)}`)
  for (const key of ['deviceId', 'edPub', 'xPub'] as const) {
    if (typeof parsed[key] !== 'string' || parsed[key].length === 0) {
      throw new Error(`pairing link missing ${key}`)
    }
  }
  if (!Array.isArray(parsed.addresses)) throw new Error('pairing link missing addresses')
  return parsed
}

export function pairingCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}
