#!/usr/bin/env node
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { HarnessKind, LocalServerMessage } from '@dsh-mesh/protocol'
import { MeshDaemon } from './daemon.js'
import { resolvePaths } from './paths.js'
import { setLogLevel } from './log.js'
import { LocalClient } from './local-client.js'

interface Flags {
  [key: string]: string | boolean | undefined
}

function parseFlags(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = []
  const flags: Flags = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split('=', 2)
    if (inline !== undefined) {
      flags[key!] = inline
      continue
    }
    const next = args[index + 1]
    if (next && !next.startsWith('--')) {
      flags[key!] = next
      index++
    } else {
      flags[key!] = true
    }
  }
  return { positional, flags }
}

function pathsFor(flags: Flags) {
  return resolvePaths(typeof flags.home === 'string' ? flags.home : undefined)
}

function printEvent(message: LocalServerMessage): void {
  if (message.t === 'event') {
    const event = message.event
    switch (event.kind) {
      case 'message':
        console.log(event.text)
        return
      case 'thought':
        console.log(`\x1b[2m[thought] ${event.text}\x1b[0m`)
        return
      case 'user':
        console.log(`\x1b[36m[user] ${event.text}\x1b[0m`)
        return
      case 'tool':
        console.log(`\x1b[33m[tool] ${event.title} (${event.status})\x1b[0m${event.detail ? '\n' + event.detail : ''}`)
        return
      case 'permission':
        console.log(`\x1b[35m[approval] ${event.title}\x1b[0m`)
        return
      case 'end':
        console.log(`\x1b[32m[end] ${event.stopReason ?? 'done'}\x1b[0m`)
        return
      case 'error':
        console.error(`\x1b[31m[error] ${event.message}\x1b[0m`)
        return
      case 'context':
        if (event.used != null) console.log(`\x1b[2m[context] ${event.used}/${event.size ?? '?'}\x1b[0m`)
        return
      case 'config':
        console.log(`\x1b[2m[config] ${event.model ?? ''}\x1b[0m`)
        return
    }
    return
  }
  if (message.t === 'approval/request') {
    console.log(`\x1b[35m[approval] ${message.approval.title} (${message.approval.approvalId})\x1b[0m`)
    for (const option of message.approval.options) {
      console.log(`  - ${option.optionId}: ${option.name}`)
    }
    return
  }
  if (message.t === 'approval/resolved') {
    console.log(`\x1b[35m[approval resolved] ${message.resolved.approvalId} by ${message.resolved.byName}\x1b[0m`)
    return
  }
  if (message.t === 'error') console.error(`error: ${message.message}`)
}

async function withClient(flags: Flags, fn: (client: LocalClient) => Promise<void>): Promise<void> {
  const client = await LocalClient.connect(pathsFor(flags))
  try {
    await fn(client)
  } finally {
    client.close()
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const { positional, flags } = parseFlags(rest)

  switch (command) {
    case undefined:
    case 'help':
    case '--help': {
      console.log(USAGE)
      return
    }
    case 'up': {
      if (flags.daemon) {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'up', ...rest.filter((item) => item !== '--daemon')], {
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
        console.log(`meshd started in background (pid ${child.pid ?? 'unknown'})`)
        return
      }
      const paths = pathsFor(flags)
      const daemon = new MeshDaemon(paths, {
        port: flags.port ? Number(flags.port) : undefined,
        panelPort: flags['panel-port'] ? Number(flags['panel-port']) : undefined,
        bind: typeof flags.bind === 'string' ? flags.bind : undefined,
        name: typeof flags.name === 'string' ? flags.name : undefined,
        discovery: flags['no-mdns'] ? { mdns: false } : undefined,
        logLevel: typeof flags['log-level'] === 'string' ? (flags['log-level'] as 'debug') : undefined,
      } as never)
      setLogLevel(typeof flags['log-level'] === 'string' ? (flags['log-level'] as 'info') : 'info')
      await daemon.start()
      const shutdown = async () => {
        await daemon.stop()
        process.exit(0)
      }
      process.on('SIGINT', () => void shutdown())
      process.on('SIGTERM', () => void shutdown())
      return
    }
    case 'status': {
      const client = await LocalClient.connect(pathsFor(flags))
      client.send({ t: 'status' })
      const reply = await client.next((message) => message.t === 'ok' && message.op === 'status' || message.t === 'error')
      console.log(JSON.stringify(reply, null, 2))
      client.close()
      return
    }
    case 'devices': {
      await withClient(flags, async (client) => {
        client.send({ t: 'devices/list' })
        const reply = await client.next((message) => message.t === 'devices' || message.t === 'error')
        if (reply.t === 'devices') {
          for (const device of reply.devices) {
            const state = device.online ? 'online' : 'offline'
            console.log(`${device.name}\t${device.deviceId}\t${state}\t${device.addresses.join(',')}`)
          }
        }
      })
      return
    }
    case 'pair': {
      await withClient(flags, async (client) => {
        client.send({ t: 'pair/create' })
        const reply = await client.next((message) => message.t === 'pairing' || message.t === 'error')
        if (reply.t === 'pairing') {
          console.log(`code: ${reply.code}`)
          console.log(reply.link)
        }
      })
      return
    }
    case 'accept': {
      const link = positional[0]
      if (!link) throw new Error('usage: meshd accept <pairing-link>')
      await withClient(flags, async (client) => {
        client.send({ t: 'pair/accept', link })
        const reply = await client.next((message) => message.t === 'ok' || message.t === 'error')
        console.log(JSON.stringify(reply, null, 2))
      })
      return
    }
    case 'send': {
      const [target, ...words] = positional
      if (!target || words.length === 0) throw new Error('usage: meshd send <device> "<prompt>" [--cwd <dir>] [--harness dsh|opencode]')
      const prompt = words.join(' ')
      const cwd = typeof flags.cwd === 'string' ? flags.cwd : process.cwd()
      const harness = typeof flags.harness === 'string' ? (flags.harness as HarnessKind) : 'dsh'
      await withClient(flags, async (client) => {
        client.send({
          t: 'task/create',
          target,
          cwd,
          prompt,
          harness,
          approvalPolicy: flags['approval-policy'] === 'never' ? 'never' : 'ask',
        })
        const created = await client.next((message) => (message.t === 'ok' && message.op === 'task/create') || message.t === 'error')
        if (created.t !== 'ok') {
          console.error(created.t === 'error' ? created.message : 'unexpected reply from meshd')
          process.exitCode = 1
          return
        }
        const taskId = (created.value as { taskId: string }).taskId
        console.log(`task ${taskId} -> ${target}${flags.wait ? '' : ' (running; use meshd attach ' + taskId + ')'}`)
        if (!flags.wait) return
        client.send({ t: 'task/attach', taskId })
        const done = await new Promise<void>((resolve) => {
          const off = client.onEvent((message) => {
            if (message.t !== 'event' || message.taskId !== taskId) return
            if (flags.json) console.log(JSON.stringify(message))
            else printEvent(message)
            if (message.event.kind === 'end' || message.event.kind === 'error') {
              off()
              resolve()
            }
          })
        })
        await done
        client.send({ t: 'tasks/list' })
        const tasks = await client.next((message) => message.t === 'tasks' || message.t === 'error')
        if (tasks.t === 'tasks') {
          const task = tasks.tasks.find((entry) => entry.taskId === taskId)
          if (task) console.log(`status: ${task.status}`)
        }
      })
      return
    }
    case 'attach': {
      const taskId = positional[0]
      if (!taskId) throw new Error('usage: meshd attach <taskId>')
      await withClient(flags, async (client) => {
        client.send({ t: 'task/attach', taskId, from: flags.from ? Number(flags.from) : 1 })
        await client.next((message) => message.t === 'ok' && message.op === 'task/attach')
        await new Promise<void>((resolve) => {
          const off = client.onEvent((message) => {
            if (message.t !== 'event' || message.taskId !== taskId) return
            if (flags.json) console.log(JSON.stringify(message))
            else printEvent(message)
            if (message.event.kind === 'end') {
              off()
              resolve()
            }
          })
          process.on('SIGINT', () => {
            off()
            resolve()
          })
        })
      })
      return
    }
    case 'approvals': {
      await withClient(flags, async (client) => {
        client.send({ t: 'approvals/list' })
        const reply = await client.next((message) => message.t === 'approvals' || message.t === 'error')
        if (reply.t === 'approvals') {
          for (const approval of reply.approvals) {
            console.log(`${approval.approvalId}\t${approval.targetName}\t${approval.title}`)
            for (const option of approval.options) console.log(`  ${option.optionId}\t${option.name}`)
          }
        }
      })
      return
    }
    case 'approve': {
      const [approvalId, optionId] = positional
      if (!approvalId || !optionId) throw new Error('usage: meshd approve <approvalId> <optionId>')
      await withClient(flags, async (client) => {
        client.send({ t: 'approval/respond', approvalId, optionId })
        const reply = await client.next((message) => message.t === 'ok' || message.t === 'error')
        console.log(JSON.stringify(reply, null, 2))
      })
      return
    }
    case 'sync-profile': {
      await withClient(flags, async (client) => {
        client.send({ t: 'profile/sync' })
        const reply = await client.next((message) => message.t === 'ok' || message.t === 'error')
        console.log(JSON.stringify(reply, null, 2))
      })
      return
    }
    default:
      console.error(`unknown command: ${command}`)
      console.log(USAGE)
      process.exitCode = 1
  }
}

const USAGE = `meshd — DeepSeek Harness device mesh

  meshd up [--daemon] [--name N] [--port 47821] [--panel-port 47822] [--home DIR]
  meshd status | devices
  meshd pair                     print a pairing link + code
  meshd accept <link>            accept a pairing link
  meshd send <device> "<prompt>" [--cwd DIR] [--harness dsh|opencode] [--wait] [--json]
  meshd attach <taskId> [--from SEQ]
  meshd approvals                list pending approvals across the mesh
  meshd approve <approvalId> <optionId>
  meshd sync-profile             sync the mesh dsh profile with the desktop model route
`

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
