import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent, TaskSpec } from '@dsh-mesh/protocol'
import { AcpAdapter } from '../src/adapters/acp.js'

const stub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-agent.mjs')

function spec(): TaskSpec {
  return {
    taskId: 'task-test',
    originDeviceId: 'dev-a',
    targetDeviceId: 'dev-b',
    cwd: process.cwd(),
    prompt: 'hello',
    harness: 'codex',
    approvalPolicy: 'ask',
    createdAt: Date.now(),
  }
}

describe('ACP adapter', () => {
  it('maps updates and relays a permission decision', async () => {
    const adapter = new AcpAdapter('codex', process.execPath, [stub])
    const events: SessionEvent[] = []
    const seen: string[] = []
    const handle = await adapter.start(spec(), {
      onEvent: (event) => events.push(event),
      onApproval: async ({ title, options }) => {
        seen.push(`${title}:${options.map((option) => option.optionId).join(',')}`)
        return 'allow'
      },
    })
    const stop = await handle.prompt('run it')
    await handle.close()

    expect(stop).toBe('end_turn')
    expect(seen).toEqual(['Run echo:allow,reject'])
    const messages = events.filter((event) => event.kind === 'message').map((event) => event.text)
    expect(messages).toContain('working on it')
    expect(messages).toContain('decision:selected:allow')
  })
})
