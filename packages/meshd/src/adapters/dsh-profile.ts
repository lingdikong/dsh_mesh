import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Logger } from '../log.js'
import { ensureDir, readJson, writeText } from '../paths.js'

interface DesktopPackage {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

export interface ModelRoute {
  provider: string
  model: string
}

function dshHome(): string {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
}

/** Reads the `agent-default-model` row out of the desktop profile's patch file. */
export function readDesktopModelRoute(): ModelRoute | undefined {
  const patch = path.join(dshHome(), 'profiles', 'desktop', 'cordis.patch.yml')
  let text: string
  try {
    text = fs.readFileSync(patch, 'utf8')
  } catch {
    return undefined
  }
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^\s*-\s+id:\s*agent-default-model\s*$/.test(line))
  if (start < 0) return undefined
  let provider: string | undefined
  let model: string | undefined
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (/^\s*-\s+id:/.test(line)) break
    const match = /^\s+(provider|model):\s*['"]?([^'"\s#]+)['"]?/.exec(line)
    if (match) {
      if (match[1] === 'provider') provider = match[2]
      if (match[1] === 'model') model = match[2]
    }
  }
  return provider && model ? { provider, model } : undefined
}

function scaffoldProfile(profileDir: string, profile: string): void {
  ensureDir(profileDir)
  writeText(
    path.join(profileDir, 'package.json'),
    JSON.stringify(
      {
        name: `dsh-profile-${profile}`,
        private: true,
        dependencies: {},
        dsh: {
          profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] },
        },
      },
      null,
      2,
    ) + '\n',
  )
  writeText(path.join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeText(
    path.join(profileDir, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
  )
}

function ensureProfile(command: string, profile: string, log: Logger): string {
  const profileDir = path.join(dshHome(), 'profiles', profile)
  if (fs.existsSync(path.join(profileDir, 'package.json'))) return profileDir
  log.info(`creating dsh profile "${profile}" from the acp template`)
  const result = spawnSync(
    command,
    ['--profile', profile, '--from-default-profile', 'acp', '--dump-config'],
    { encoding: 'utf8', timeout: 120_000 },
  )
  if (result.status !== 0 || !fs.existsSync(path.join(profileDir, 'package.json'))) {
    log.warn(`profile template init failed (${String(result.status)}); scaffolding manually`)
    scaffoldProfile(profileDir, profile)
  }
  return profileDir
}

/**
 * Keeps the mesh profile able to run tasks with the same provider/model as the
 * desktop profile. Best effort: failures are logged, never fatal.
 */
export function syncDshProfile(command: string, profile: string, log: Logger): void {
  try {
    const profileDir = ensureProfile(command, profile, log)
    const route = readDesktopModelRoute()
    if (!route) {
      log.warn('desktop profile has no agent-default-model route; leaving mesh profile defaults')
      return
    }
    const desktopPackage = readJson<DesktopPackage>(
      path.join(dshHome(), 'profiles', 'desktop', 'package.json'),
    )
    const version = desktopPackage?.dependencies?.[route.provider]
    const installed = fs.existsSync(path.join(profileDir, 'node_modules', route.provider))
    if (version && !installed) {
      log.info(`installing ${route.provider}@${version} into profile "${profile}"`)
      const result = spawnSync(command, ['plugin', '--profile', profile, 'add', `${route.provider}@${version}`], {
        encoding: 'utf8',
        timeout: 180_000,
      })
      if (result.status !== 0) {
        log.warn(`provider install failed: ${(result.stderr ?? '').trim().slice(0, 400)}`)
      }
    }
    const patch = [
      '# Managed by meshd: keeps the ACP row on the desktop profile\'s model route.',
      '- id: acp',
      "  name: '@deepseek-ai/dsh-acp'",
      '  config:',
      `    provider: ${route.provider}`,
      `    model: ${route.model}`,
      '',
    ].join('\n')
    writeText(path.join(profileDir, 'cordis.patch.yml'), patch)
    log.info(`mesh profile "${profile}" uses ${route.provider}/${route.model}`)
  } catch (error) {
    log.warn(`dsh profile sync failed: ${String(error)}`)
  }
}
