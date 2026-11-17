import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface MeshPaths {
  home: string
  identity: string
  config: string
  peers: string
  panelToken: string
  sessions: string
  logs: string
}

export function resolvePaths(homeOverride?: string): MeshPaths {
  const home = path.resolve(
    homeOverride ?? process.env.DSH_MESH_HOME ?? path.join(os.homedir(), '.dsh-mesh'),
  )
  return {
    home,
    identity: path.join(home, 'identity.json'),
    config: path.join(home, 'config.json'),
    peers: path.join(home, 'peers.json'),
    panelToken: path.join(home, 'panel-token'),
    sessions: path.join(home, 'sessions'),
    logs: path.join(home, 'logs'),
  }
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

export function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return undefined
  }
}

export function writeText(file: string, value: string, mode = 0o600): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, value, { mode })
  fs.renameSync(tmp, file)
}
