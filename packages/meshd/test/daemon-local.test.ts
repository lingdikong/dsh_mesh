import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { MeshDaemon } from '../src/daemon.js'
import { resolvePaths } from '../src/paths.js'
import { setLogLevel } from '../src/log.js'

const stub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-agent.mjs')
const homes: string[] = []
const daemons: MeshDaemon[] = []

afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.stop()
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})

function makeDaemon(): MeshDaemon {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mesh-daemon-'))
  homes.push(home)
  setLogLevel('error')
  const daemon = new MeshDaemon(resolvePaths(home), {
    name: 'test-node',
    port: 0,
    panelPort: 0,
    bind: '127.0.0.1',
    discovery: { mdns: false },
    harness: { codex: { command: process.execPath, args: [stub] } },
  })
  daemons.push(daemon)
  return daemon
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 8000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = fn()
    if (value !== undefined) return value
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('daemon local task + mesh approval', () => {
  it('runs a task and resolves its approval', async () => {
    const daemon = makeDaemon()
    await daemon.start()
    const { taskId } = await daemon.createTask({
      target: 'self',
      cwd: process.cwd(),
      prompt: 'run it',
      harness: 'codex',
      approvalPolicy: 'ask',
    })
    const approval = await waitFor(() => daemon.pendingApprovals()[0])
    expect(approval.title).toBe('Run echo')
    const result = daemon.respondApproval(approval.approvalId, 'allow')
    expect(result.ok).toBe(true)

    const summary = await waitFor(() =>
      daemon.tasks().find((task) => task.taskId === taskId && task.status === 'done'),
    )
    expect(summary.stopReason).toBe('end_turn')
    const events = daemon.taskEvents(taskId)
    const messages = events.filter((entry) => entry.event.kind === 'message')
    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(daemon.pendingApprovals()).toHaveLength(0)
  })
})
