import fs from 'node:fs'
import path from 'node:path'
import type { SessionEvent, TaskSpec, TaskStatus, TaskSummary } from '@dsh-mesh/protocol'
import { ensureDir } from './paths.js'

export interface StoredEvent {
  seq: number
  event: SessionEvent
}

export interface TaskRecord {
  spec: TaskSpec
  status: TaskStatus
  seq: number
  events: StoredEvent[]
  stopReason?: string
  updatedAt: number
}

type Line =
  | { type: 'meta'; spec: TaskSpec; at: number }
  | { type: 'event'; seq: number; event: SessionEvent }
  | { type: 'status'; status: TaskStatus; stopReason?: string; at: number }

export class TaskStore {
  private tasks = new Map<string, TaskRecord>()
  private listeners = new Set<(taskId: string, seq: number, event: SessionEvent) => void>()

  constructor(private readonly dir: string) {
    ensureDir(dir)
    this.load()
  }

  create(spec: TaskSpec): TaskRecord {
    const record: TaskRecord = {
      spec,
      status: 'queued',
      seq: 0,
      events: [],
      updatedAt: Date.now(),
    }
    this.tasks.set(spec.taskId, record)
    this.appendLine(spec.taskId, { type: 'meta', spec, at: spec.createdAt })
    return record
  }

  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId)
  }

  list(): TaskSummary[] {
    return [...this.tasks.values()]
      .sort((a, b) => b.spec.createdAt - a.spec.createdAt)
      .map((record) => ({
        taskId: record.spec.taskId,
        originDeviceId: record.spec.originDeviceId,
        targetDeviceId: record.spec.targetDeviceId,
        targetName: record.spec.targetName,
        cwd: record.spec.cwd,
        harness: record.spec.harness,
        prompt: record.spec.prompt,
        status: record.status,
        createdAt: record.spec.createdAt,
        updatedAt: record.updatedAt,
        lastSeq: record.seq,
        stopReason: record.stopReason,
      }))
  }

  append(taskId: string, event: SessionEvent): number {
    const record = this.tasks.get(taskId)
    if (!record) throw new Error(`unknown task ${taskId}`)
    const seq = ++record.seq
    record.events.push({ seq, event })
    record.updatedAt = Date.now()
    this.appendLine(taskId, { type: 'event', seq, event })
    for (const listener of this.listeners) listener(taskId, seq, event)
    return seq
  }

  setStatus(taskId: string, status: TaskStatus, stopReason?: string): void {
    const record = this.tasks.get(taskId)
    if (!record) return
    record.status = status
    record.stopReason = stopReason
    record.updatedAt = Date.now()
    this.appendLine(taskId, { type: 'status', status, stopReason, at: record.updatedAt })
  }

  subscribe(listener: (taskId: string, seq: number, event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  eventsFrom(taskId: string, from = 1): StoredEvent[] {
    const record = this.tasks.get(taskId)
    if (!record) return []
    return record.events.filter((entry) => entry.seq >= from)
  }

  private file(taskId: string): string {
    return path.join(this.dir, `${taskId}.jsonl`)
  }

  private appendLine(taskId: string, line: Line): void {
    fs.appendFileSync(this.file(taskId), JSON.stringify(line) + '\n', 'utf8')
  }

  private load(): void {
    let entries: string[] = []
    try {
      entries = fs.readdirSync(this.dir).filter((name) => name.endsWith('.jsonl'))
    } catch {
      return
    }
    for (const name of entries) {
      const taskId = name.replace(/\.jsonl$/, '')
      let lines: Line[] = []
      try {
        lines = fs
          .readFileSync(path.join(this.dir, name), 'utf8')
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line) as Line)
      } catch {
        continue
      }
      let record: TaskRecord | undefined
      for (const line of lines) {
        if (line.type === 'meta') {
          record = { spec: line.spec, status: 'queued', seq: 0, events: [], updatedAt: line.at }
          this.tasks.set(taskId, record)
        } else if (line.type === 'event' && record) {
          record.events.push({ seq: line.seq, event: line.event })
          record.seq = Math.max(record.seq, line.seq)
        } else if (line.type === 'status' && record) {
          record.status = line.status
          record.stopReason = line.stopReason
          record.updatedAt = line.at
        }
      }
    }
  }
}
