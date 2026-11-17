import { describe, expect, it } from 'vitest'
import type { ApprovalRequest } from '@dsh-mesh/protocol'
import { ApprovalBroker } from '../src/approvals.js'

function request(id = 'ap-1'): ApprovalRequest {
  return {
    approvalId: id,
    taskId: 'task-1',
    targetDeviceId: 'dev-b',
    targetName: 'nodeB',
    title: 'Run echo',
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
    at: Date.now(),
  }
}

describe('approval broker', () => {
  it('lets the first responder win and ignores later answers', async () => {
    const broker = new ApprovalBroker()
    const pending = broker.ask(request())
    expect(broker.list()).toHaveLength(1)

    const first = broker.respond('ap-1', 'allow', 'dev-a', 'nodeA')
    expect(first?.byDeviceId).toBe('dev-a')
    expect(await pending).toBe('allow')

    expect(broker.respond('ap-1', 'reject', 'dev-c', 'nodeC')).toBeUndefined()
    expect(broker.list()).toHaveLength(0)
  })

  it('settles null when the request times out', async () => {
    const broker = new ApprovalBroker()
    const pending = broker.ask(request('ap-2'), 20)
    expect(await pending).toBeNull()
  })
})
