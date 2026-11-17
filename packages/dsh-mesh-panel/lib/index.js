/**
 * Host half of dsh-mesh-panel.
 *
 * Exposes the local mesh daemon to the Desktop renderer on the same origin
 * (`/mesh/*`) and registers model tools so the agent can delegate from chat.
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-mesh-panel'
export const inject = ['webServer']

const ROUTE = '/mesh'

function meshHome() {
  return process.env.DSH_MESH_HOME ?? path.join(os.homedir(), '.dsh-mesh')
}

function panelPort() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(meshHome(), 'config.json'), 'utf8'))
    return Number(config.panelPort) || 47822
  } catch {
    return 47822
  }
}

function panelToken() {
  try {
    return fs.readFileSync(path.join(meshHome(), 'panel-token'), 'utf8').trim()
  } catch {
    return undefined
  }
}

function callMesh(method, apiPath, body) {
  const token = panelToken()
  if (!token) {
    return Promise.reject(new Error('meshd is not running (no panel token in ~/.dsh-mesh)'))
  }
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const request = http.request(
      {
        host: '127.0.0.1',
        port: panelPort(),
        path: apiPath,
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed
          try {
            parsed = text ? JSON.parse(text) : {}
          } catch {
            reject(new Error(`meshd returned non-JSON (${response.statusCode}): ${text.slice(0, 200)}`))
            return
          }
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(parsed.error ?? parsed.message ?? `meshd error ${response.statusCode}`))
            return
          }
          resolve(parsed)
        })
      },
    )
    request.on('error', reject)
    if (payload) request.write(payload)
    request.end()
  })
}

function isLoopbackHost(hostHeader) {
  const host = (hostHeader ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

async function proxy(request, response) {
  const origin = request.headers.origin
  if (origin && !origin.startsWith('dsh-app://')) {
    try {
      if (new URL(origin).host !== request.headers.host) {
        response.writeHead(403, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'cross-origin request refused' }))
        return
      }
    } catch {
      response.writeHead(403, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'bad origin' }))
      return
    }
  }
  if (!isLoopbackHost(request.headers.host)) {
    response.writeHead(403, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'device mesh is loopback-only' }))
    return
  }
  const token = panelToken()
  if (!token) {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'meshd is not running' }))
    return
  }
  let body
  try {
    body = await readBody(request)
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: String(error) }))
    return
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const tail = url.pathname.slice(ROUTE.length)
  const rest = tail === '' || tail === '/' ? '/snapshot' : tail
  const target = `/api${rest.startsWith('/') ? rest : `/${rest}`}${url.search}`
  const headers = { authorization: `Bearer ${token}` }
  if (body.length > 0) {
    headers['content-type'] = request.headers['content-type'] ?? 'application/json'
    headers['content-length'] = String(body.length)
  }
  const upstream = http.request(
    { host: '127.0.0.1', port: panelPort(), path: target, method: request.method, headers },
    (proxied) => {
      response.writeHead(proxied.statusCode ?? 502, {
        'content-type': proxied.headers['content-type'] ?? 'application/json',
      })
      proxied.pipe(response)
    },
  )
  upstream.on('error', (error) => {
    response.writeHead(502, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: String(error) }))
  })
  if (body.length > 0) upstream.write(body)
  upstream.end()
}

function jsonOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

function tool(definition) {
  return {
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    ...definition,
    output: definition.output ?? jsonOutput(),
  }
}

function registerTools(ctx) {
  const tools = ctx.get('tools')
  if (!tools) return

  tools.register(
    tool({
      name: 'mesh_devices',
      description:
        'List the paired dsh-mesh devices and whether each is online. Use it before delegating work.',
      parameters: {},
      output: jsonOutput(),
      async execute() {
        const result = await callMesh('GET', '/api/devices')
        return { devices: result.devices }
      },
    }),
  )

  tools.register(
    tool({
      name: 'mesh_task',
      description:
        'Dispatch a coding task to another paired device. Returns a task id; poll mesh_task_status for progress.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Target device name or id' },
          prompt: { type: 'string', description: 'The task text for the remote agent' },
          cwd: { type: 'string', description: 'Absolute working directory on the target device' },
          harness: {
            type: 'string',
            enum: ['dsh', 'opencode'],
            description: 'Harness to run on the target (default dsh)',
          },
        },
        required: ['device', 'prompt'],
        additionalProperties: false,
      },
      output: jsonOutput(),
      async execute(args) {
        const result = await callMesh('POST', '/api/tasks', {
          target: args.device,
          prompt: args.prompt,
          cwd: args.cwd ?? process.cwd(),
          harness: args.harness ?? 'dsh',
        })
        return result
      },
    }),
  )

  tools.register(
    tool({
      name: 'mesh_task_status',
      description: 'Read one mesh task: status, target, and its most recent events.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task id returned by mesh_task' },
        },
        required: ['taskId'],
        additionalProperties: false,
      },
      output: jsonOutput(),
      async execute(args) {
        const result = await callMesh(
          'GET',
          `/api/snapshot?taskId=${encodeURIComponent(args.taskId)}&from=1`,
        )
        const task = result.tasks.find((entry) => entry.taskId === args.taskId)
        return {
          task: task ?? null,
          events: result.events.slice(-40),
        }
      },
    }),
  )

  tools.register(
    tool({
      name: 'mesh_task_input',
      description: 'Queue a follow-up prompt for a running mesh task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task id' },
          text: { type: 'string', description: 'Follow-up instruction' },
        },
        required: ['taskId', 'text'],
        additionalProperties: false,
      },
      output: jsonOutput(),
      async execute(args) {
        return callMesh('POST', `/api/tasks/${encodeURIComponent(args.taskId)}/input`, {
          text: args.text,
        })
      },
    }),
  )
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: (request, response) => {
        void proxy(request, response)
      },
    }),
  )
  registerTools(ctx)
}
