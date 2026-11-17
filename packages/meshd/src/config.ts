import os from 'node:os'
import path from 'node:path'
import type { HarnessKind } from '@dsh-mesh/protocol'
import type { LogLevel } from './log.js'
import { ensureDir, readJson, writeJson, type MeshPaths } from './paths.js'

export interface HarnessCommand {
  command: string
  args: string[]
}

export interface MeshConfig {
  name: string
  port: number
  bind: string
  panelPort: number
  profile: string
  harness: Partial<Record<HarnessKind, HarnessCommand>>
  allowedRoots: string[]
  discovery: { mdns: boolean }
  logLevel: LogLevel
}

export function defaultConfig(): MeshConfig {
  return {
    name: os.hostname().replace(/\.local$/i, ''),
    port: 47821,
    bind: '0.0.0.0',
    panelPort: 47822,
    profile: 'mesh',
    harness: {
      dsh: { command: 'dsh', args: ['--profile', 'mesh'] },
      opencode: { command: 'opencode', args: ['acp'] },
    },
    allowedRoots: [path.join(os.homedir())],
    discovery: { mdns: true },
    logLevel: 'info',
  }
}

export function loadConfig(paths: MeshPaths, overrides: Partial<MeshConfig> = {}): MeshConfig {
  ensureDir(paths.home)
  const stored = readJson<Partial<MeshConfig>>(paths.config)
  const clean = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<MeshConfig>
  const config: MeshConfig = {
    ...defaultConfig(),
    ...stored,
    ...clean,
    harness: { ...defaultConfig().harness, ...stored?.harness, ...clean.harness },
    discovery: { ...defaultConfig().discovery, ...stored?.discovery, ...clean.discovery },
  }
  if (!stored) writeJson(paths.config, config)
  return config
}

export function saveConfig(paths: MeshPaths, config: MeshConfig): void {
  ensureDir(paths.home)
  writeJson(paths.config, config)
}
