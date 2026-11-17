import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import {
  PAIRING_VERSION,
  deviceIdOf,
  encodePairingLink,
  fromB64u,
  pairingCode,
  parsePairingLink,
  type ApprovalRequest,
  type ApprovalResolved,
  type DeviceId,
  type DeviceInfo,
  type HarnessKind,
  type MeshMessage,
  type SessionEvent,
  type TaskSpec,
  type TaskSummary,
} from '@dsh-mesh/protocol'
import type { MeshPaths } from './paths.js'
import { ensureDir, readText, writeText } from './paths.js'
import { loadConfig, saveConfig, type MeshConfig } from './config.js'
import { loadOrCreateIdentity, type Identity } from './identity.js'
import { PeerStore, type PeerRecord } from './peers.js'
import { MeshServer } from './net/server.js'
import { PeerLink } from './net/peer-link.js'
import { MeshConnection } from './net/connection.js'
import { Discovery } from './discovery.js'
import { TaskStore, type StoredEvent } from './store.js'
import { ApprovalBroker } from './approvals.js'
import { adapterFor } from './adapters/index.js'
import { syncDshProfile } from './adapters/dsh-profile.js'
import type { TaskHandle } from './adapters/types.js'
import { LocalApi, type CreateTaskInput, type LocalApiHost } from './local-api.js'
import { logger } from './log.js'

const log = logger('daemon')
const VERSION = '0.1.0'

export class MeshDaemon implements LocalApiHost {
  readonly config: MeshConfig
  readonly identity: Identity
  readonly peers: PeerStore
  readonly store: TaskStore
  readonly approvals = new ApprovalBroker()
  private readonly links = new Map<DeviceId, PeerLink>()
  private readonly handles = new Map<string, TaskHandle>()
  private readonly queues = new Map<string, string[]>()
  private readonly remoteApprovals = new Map<string, { approval: ApprovalRequest; peerId: DeviceId }>()
  private readonly connections = new Set<MeshConnection>()
  private server?: MeshServer
  private discovery?: Discovery
  private localApi?: LocalApi
  private port: number
  private token: string
  private startedAt = Date.now()
  private timers: NodeJS.Timeout[] = []

  constructor(
    private readonly paths: MeshPaths,
    overrides: Partial<MeshConfig> = {},
  ) {
    ensureDir(paths.home)
    ensureDir(paths.sessions)
    ensureDir(paths.logs)
    this.config = loadConfig(paths, overrides)
    this.identity = loadOrCreateIdentity(paths)
    this.peers = new PeerStore(paths)
    this.store = new TaskStore(paths.sessions)
    this.port = this.config.port
    this.token = this.ensureToken()
  }

  async start(): Promise<void> {
    const server = new MeshServer(this.identity, this.peers, (connection) => this.onConnection(connection))
    this.server = server
    this.port = await server.start(this.config.bind, this.config.port)
    if (this.config.port !== this.port) {
      this.config.port = this.port
      saveConfig(this.paths, this.config)
    }

    if (this.config.discovery.mdns) {
      const discovery = new Discovery(
        { deviceId: this.identity.deviceId, name: this.config.name, port: this.port },
        (deviceId, address) => this.onDiscoveredAddress(deviceId, address),
      )
      discovery.start()
      this.discovery = discovery
    }

    for (const peer of this.peers.list()) this.startLink(peer)

    const localApi = new LocalApi(this.paths, this.token, this)
    await localApi.start(this.config.panelPort)
    this.localApi = localApi

    this.timers.push(
      setInterval(() => {
        for (const link of this.links.values()) link.send({ t: 'ping', at: Date.now() })
        this.broadcastDevices()
      }, 15000),
    )

    if (this.config.harness.dsh) {
      const command = this.config.harness.dsh.command
      setTimeout(() => syncDshProfile(command, this.config.profile, logger('dsh-profile')), 500)
    }

    log.info(
      `meshd ${VERSION} up as ${this.config.name} (${this.identity.deviceId}) mesh:${this.port} panel:${this.config.panelPort}`,
    )
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    this.discovery?.stop()
    this.localApi?.close()
    for (const link of this.links.values()) link.stop()
    this.server?.close()
    for (const handle of this.handles.values()) {
      try {
        await handle.close()
      } catch {
        // ignore
      }
    }
    this.approvals.cancelAll()
  }

  // ---- LocalApiHost ----

  deviceInfo(): DeviceInfo {
    return {
      deviceId: this.identity.deviceId,
      name: this.config.name,
      platform: process.platform,
      addresses: this.selfAddresses(),
      version: VERSION,
      online: true,
      lastSeen: Date.now(),
    }
  }

  devices(): DeviceInfo[] {
    const list: DeviceInfo[] = [this.deviceInfo()]
    for (const peer of this.peers.list()) {
      list.push({
        deviceId: peer.deviceId,
        name: peer.name,
        platform: peer.platform,
        addresses: peer.addresses,
        version: VERSION,
        online: this.links.get(peer.deviceId)?.connected ?? false,
        lastSeen: peer.lastSeen,
      })
    }
    return list
  }

  tasks(): TaskSummary[] {
    return this.store.list()
  }

  taskEvents(taskId: string, from = 1): StoredEvent[] {
    return this.store.eventsFrom(taskId, from)
  }

  pendingApprovals(): ApprovalRequest[] {
    return [...this.approvals.list(), ...[...this.remoteApprovals.values()].map((entry) => entry.approval)]
  }

  async createTask(input: CreateTaskInput): Promise<{ taskId: string }> {
    const target = this.resolveDevice(input.target)
    if (!target) throw new Error(`unknown device "${input.target}"`)
    // Only normalise paths for this device: a remote device's path syntax is its own.
    const cwd = target.deviceId === this.identity.deviceId ? path.resolve(input.cwd) : input.cwd
    const spec: TaskSpec = {
      taskId: `task-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      originDeviceId: this.identity.deviceId,
      targetDeviceId: target.deviceId,
      targetName: target.name,
      cwd,
      prompt: input.prompt,
      harness: input.harness ?? 'dsh',
      model: input.model,
      approvalPolicy: input.approvalPolicy ?? 'ask',
      createdAt: Date.now(),
    }
    this.store.create(spec)
    this.localApi?.broadcast({ t: 'task', task: this.summary(spec.taskId) })
    if (target.deviceId === this.identity.deviceId) {
      void this.execute(spec)
      return { taskId: spec.taskId }
    }
    const link = this.links.get(target.deviceId)
    if (!link || !link.send({ t: 'task/request', task: spec })) {
      this.failTask(spec, `device "${target.name}" is offline`)
      throw new Error(`device "${target.name}" is offline`)
    }
    return { taskId: spec.taskId }
  }

  inputTask(taskId: string, text: string): void {
    const handle = this.handles.get(taskId)
    if (!handle) throw new Error('task is not running on this device')
    this.queues.get(taskId)?.push(text)
  }

  cancelTask(taskId: string): void {
    const handle = this.handles.get(taskId)
    if (handle) {
      handle.cancel()
      return
    }
    const record = this.store.get(taskId)
    if (record && record.spec.targetDeviceId !== this.identity.deviceId) {
      this.links.get(record.spec.targetDeviceId)?.send({ t: 'task/cancel', taskId })
    }
  }

  respondApproval(approvalId: string, optionId: string): { ok: boolean; message?: string } {
    const local = this.approvals.respond(approvalId, optionId, this.identity.deviceId, this.config.name)
    if (local) {
      this.announceResolved(local)
      return { ok: true }
    }
    const remote = this.remoteApprovals.get(approvalId)
    if (remote) {
      this.links.get(remote.peerId)?.send({ t: 'approval/respond', approvalId, optionId })
      return { ok: true }
    }
    return { ok: false, message: 'approval already resolved or unknown' }
  }

  createPairing(ttlMs = 10 * 60 * 1000): { link: string; code: string; expiresAt: number } {
    const code = pairingCode()
    const expiresAt = Date.now() + ttlMs
    const link = encodePairingLink({
      v: PAIRING_VERSION,
      deviceId: this.identity.deviceId,
      name: this.config.name,
      platform: process.platform,
      edPub: this.identity.edPub,
      xPub: this.identity.xPub,
      addresses: this.selfAddresses(),
      code,
      expiresAt,
    })
    log.info(`pairing link created; code ${code}`)
    return { link, code, expiresAt }
  }

  acceptPairing(link: string): { deviceId: string; name: string } {
    const payload = parsePairingLink(link)
    if (payload.expiresAt < Date.now()) throw new Error('pairing link expired')
    if (deviceIdOf(fromB64u(payload.edPub)) !== payload.deviceId) {
      throw new Error('pairing link device id does not match its key')
    }
    if (payload.deviceId === this.identity.deviceId) throw new Error('cannot pair with self')
    const record = this.peers.add({
      deviceId: payload.deviceId,
      name: payload.name,
      platform: payload.platform,
      edPub: payload.edPub,
      xPub: payload.xPub,
      addresses: payload.addresses,
    })
    this.startLink(record)
    this.broadcastDevices()
    log.info(`paired with ${payload.name} (${payload.deviceId})`)
    return { deviceId: payload.deviceId, name: payload.name }
  }

  syncProfile(): void {
    const dsh = this.config.harness.dsh
    if (!dsh) throw new Error('dsh harness is not configured')
    syncDshProfile(dsh.command, this.config.profile, logger('dsh-profile'))
  }

  // ---- mesh ----

  private onConnection(connection: MeshConnection): void {
    const peerId = connection.peer.deviceId
    this.connections.add(connection)
    this.peers.touch(peerId)
    connection.on('message', (message: MeshMessage) => this.onMeshMessage(connection, message))
    connection.on('close', () => {
      this.connections.delete(connection)
      this.broadcastDevices()
    })
    connection.on('error', (error: unknown) => log.debug(`link error: ${String(error)}`))
    connection.send({ t: 'devices/snapshot', devices: this.devices() })
    this.broadcastDevices()
    log.info(`link up with ${connection.peer.name} (${connection.outbound ? 'outbound' : 'inbound'})`)
  }

  private onMeshMessage(connection: MeshConnection, message: MeshMessage): void {
    switch (message.t) {
      case 'ping':
        connection.send({ t: 'pong', at: message.at })
        return
      case 'pong':
        this.peers.touch(connection.peer.deviceId)
        return
      case 'devices/snapshot':
        for (const device of message.devices) {
          if (device.deviceId === this.identity.deviceId) continue
          if (this.peers.get(device.deviceId)) this.peers.touch(device.deviceId)
        }
        return
      case 'task/request':
        this.acceptTask(connection, message.task)
        return
      case 'task/accepted':
        log.debug(`task ${message.taskId} accepted`)
        this.setStatus(message.taskId, 'running')
        return
      case 'task/rejected':
        this.failTaskId(message.taskId, message.reason)
        return
      case 'task/event': {
        const record = this.store.get(message.taskId)
        if (!record) return
        if (message.event.kind === 'end') {
          const stopReason = message.event.stopReason
          this.store.setStatus(
            message.taskId,
            stopReason === 'cancelled' ? 'cancelled' : 'done',
            stopReason,
          )
        } else if (message.event.kind === 'error') {
          this.store.setStatus(message.taskId, 'failed')
        }
        const seq = this.store.append(message.taskId, message.event)
        this.localApi?.broadcast({ t: 'event', taskId: message.taskId, seq, event: message.event })
        if (message.event.kind === 'end' || message.event.kind === 'error') {
          this.localApi?.broadcast({ t: 'task', task: this.summary(message.taskId) })
        }
        return
      }
      case 'task/input':
        this.inputTask(message.taskId, message.text)
        return
      case 'task/cancel':
        this.cancelTask(message.taskId)
        return
      case 'approval/request':
        this.remoteApprovals.set(message.approval.approvalId, {
          approval: message.approval,
          peerId: connection.peer.deviceId,
        })
        this.localApi?.broadcast({ t: 'approval/request', approval: message.approval })
        return
      case 'approval/respond': {
        const resolved = this.approvals.respond(
          message.approvalId,
          message.optionId,
          connection.peer.deviceId,
          connection.peer.name,
        )
        if (resolved) this.announceResolved(resolved)
        return
      }
      case 'approval/resolved':
        this.remoteApprovals.delete(message.resolved.approvalId)
        this.localApi?.broadcast({ t: 'approval/resolved', resolved: message.resolved })
        return
      case 'error':
        log.warn(`peer error ${message.code}: ${message.message}`)
        return
    }
  }

  private acceptTask(connection: MeshConnection, spec: TaskSpec): void {
    if (spec.targetDeviceId !== this.identity.deviceId) {
      connection.send({ t: 'task/rejected', taskId: spec.taskId, reason: 'wrong device' })
      return
    }
    if (!this.withinAllowedRoot(spec.cwd)) {
      connection.send({
        t: 'task/rejected',
        taskId: spec.taskId,
        reason: `cwd ${spec.cwd} is outside allowedRoots`,
      })
      return
    }
    if (!this.config.harness[spec.harness]) {
      connection.send({
        t: 'task/rejected',
        taskId: spec.taskId,
        reason: `harness "${spec.harness}" is not configured here`,
      })
      return
    }
    this.store.create(spec)
    connection.send({ t: 'task/accepted', taskId: spec.taskId, at: Date.now() })
    this.localApi?.broadcast({ t: 'task', task: this.summary(spec.taskId) })
    void this.execute(spec)
  }

  private async execute(spec: TaskSpec): Promise<void> {
    const taskId = spec.taskId
    this.store.setStatus(taskId, 'running')
    this.emit(spec, { kind: 'user', text: spec.prompt, at: Date.now() })
    this.queues.set(taskId, [])
    let handle: TaskHandle | undefined
    try {
      const adapter = adapterFor(this.config, spec.harness)
      handle = await adapter.start(spec, {
        onEvent: (event) => this.emit(spec, event),
        onApproval: (input) => this.askApproval(spec, input),
      })
      this.handles.set(taskId, handle)
      let text = spec.prompt
      for (;;) {
        const stopReason = await handle.prompt(text)
        const next = this.queues.get(taskId)?.shift()
        if (next) {
          text = next
          this.emit(spec, { kind: 'user', text: next, at: Date.now() })
          continue
        }
        const cancelled = stopReason === 'cancelled'
        this.store.setStatus(taskId, cancelled ? 'cancelled' : 'done', stopReason)
        this.emit(spec, { kind: 'end', stopReason, at: Date.now() })
        break
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`task ${taskId} failed: ${message}`)
      this.store.setStatus(taskId, 'failed')
      this.emit(spec, { kind: 'error', message, at: Date.now() })
    } finally {
      this.handles.delete(taskId)
      this.queues.delete(taskId)
      if (handle) {
        try {
          await handle.close()
        } catch (error) {
          log.debug(`close failed: ${String(error)}`)
        }
      }
      this.localApi?.broadcast({ t: 'task', task: this.summary(taskId) })
    }
  }

  private async askApproval(
    spec: TaskSpec,
    input: { title: string; detail?: string; options: { optionId: string; name: string; kind: string }[] },
  ): Promise<string | null> {
    if (spec.approvalPolicy === 'never') return null
    const approval: ApprovalRequest = {
      approvalId: `ap-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      taskId: spec.taskId,
      targetDeviceId: this.identity.deviceId,
      targetName: this.config.name,
      title: input.title,
      detail: input.detail,
      options: input.options,
      at: Date.now(),
    }
    this.emit(spec, { kind: 'permission', approvalId: approval.approvalId, title: approval.title, at: approval.at })
    this.localApi?.broadcast({ t: 'approval/request', approval })
    for (const connection of this.connections) {
      connection.send({ t: 'approval/request', approval })
    }
    const chosen = await this.approvals.ask(approval)
    if (chosen == null) {
      this.announceResolved({
        approvalId: approval.approvalId,
        taskId: spec.taskId,
        optionId: '',
        byDeviceId: this.identity.deviceId,
        byName: this.config.name,
        at: Date.now(),
      })
      return null
    }
    return chosen
  }

  private announceResolved(resolved: ApprovalResolved): void {
    this.remoteApprovals.delete(resolved.approvalId)
    this.localApi?.broadcast({ t: 'approval/resolved', resolved })
    for (const connection of this.connections) connection.send({ t: 'approval/resolved', resolved })
  }

  private emit(spec: TaskSpec, event: SessionEvent): void {
    const seq = this.store.append(spec.taskId, event)
    this.localApi?.broadcast({ t: 'event', taskId: spec.taskId, seq, event })
    if (spec.originDeviceId !== this.identity.deviceId) {
      this.links.get(spec.originDeviceId)?.send({ t: 'task/event', taskId: spec.taskId, seq, event })
    }
  }

  private setStatus(taskId: string, status: 'running'): void {
    const record = this.store.get(taskId)
    if (!record) return
    this.store.setStatus(taskId, status)
  }

  private failTask(spec: TaskSpec, reason: string): void {
    this.store.setStatus(spec.taskId, 'failed')
    this.emit(spec, { kind: 'error', message: reason, at: Date.now() })
  }

  private failTaskId(taskId: string, reason: string): void {
    const record = this.store.get(taskId)
    if (!record) return
    this.store.setStatus(taskId, 'failed')
    this.emit(record.spec, { kind: 'error', message: reason, at: Date.now() })
  }

  private summary(taskId: string): TaskSummary {
    const summary = this.store.list().find((entry) => entry.taskId === taskId)
    if (!summary) throw new Error(`unknown task ${taskId}`)
    return summary
  }

  private resolveDevice(target: string): { deviceId: DeviceId; name: string } | undefined {
    if (target === 'self' || target === 'me' || target === this.config.name || target === this.identity.deviceId) {
      return { deviceId: this.identity.deviceId, name: this.config.name }
    }
    const peer = this.peers.findByName(target)
    return peer ? { deviceId: peer.deviceId, name: peer.name } : undefined
  }

  private withinAllowedRoot(cwd: string): boolean {
    const resolved = path.resolve(cwd)
    return this.config.allowedRoots.some((root) => {
      const base = path.resolve(root)
      return resolved === base || resolved.startsWith(base + path.sep)
    })
  }

  private selfAddresses(): string[] {
    const addresses: string[] = []
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) addresses.push(`${entry.address}:${this.port}`)
      }
    }
    return addresses
  }

  private startLink(peer: PeerRecord): void {
    if (this.links.has(peer.deviceId)) return
    const link = new PeerLink(peer, this.identity, (connection) => this.onConnection(connection))
    this.links.set(peer.deviceId, link)
    link.start()
  }

  private onDiscoveredAddress(deviceId: DeviceId, address: string): void {
    const peer = this.peers.get(deviceId)
    if (!peer) return
    if (peer.addresses.includes(address)) return
    const addresses = [address, ...peer.addresses].slice(0, 8)
    const updated = this.peers.add({ ...peer, addresses })
    const link = this.links.get(deviceId)
    if (link) link.stop()
    this.links.delete(deviceId)
    this.startLink(updated)
    log.info(`discovered ${peer.name} at ${address}`)
  }

  private broadcastDevices(): void {
    this.localApi?.broadcast({ t: 'devices', devices: this.devices() })
  }

  private ensureToken(): string {
    const existing = readText(this.paths.panelToken)
    if (existing && existing.length >= 32) return existing
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
    writeText(this.paths.panelToken, token)
    return token
  }
}
