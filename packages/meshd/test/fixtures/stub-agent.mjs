import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })
const sessionId = 'stub-session'
let promptId = null
let permissionId = null

const send = (payload) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\n')
const note = (update) => send({ method: 'session/update', params: { sessionId, update } })

rl.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
    return
  }
  if (message.method === 'session/new') {
    send({ id: message.id, result: { sessionId } })
    return
  }
  if (message.method === 'session/prompt') {
    promptId = message.id
    note({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working on it' } })
    permissionId = 9001
    send({
      id: permissionId,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: { toolCallId: 'call-1', title: 'Run echo' },
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      },
    })
    return
  }
  if (permissionId !== null && message.id === permissionId) {
    const outcome = message.result?.outcome
    note({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `decision:${outcome?.outcome ?? 'none'}:${outcome?.optionId ?? ''}` },
    })
    send({ id: promptId, result: { stopReason: 'end_turn' } })
    return
  }
  if (message.method === 'session/cancel') return
  if (message.method === 'session/close') {
    send({ id: message.id, result: {} })
    setTimeout(() => process.exit(0), 10)
  }
})
