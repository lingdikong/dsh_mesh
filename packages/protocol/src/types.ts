export const PROTOCOL_VERSION = 1

export type DeviceId = string
export type HarnessKind = 'dsh' | 'opencode' | 'claude' | 'codex'
export type ApprovalPolicy = 'ask' | 'never'

export interface DeviceInfo {
  deviceId: DeviceId
  name: string
  platform: string
  addresses: string[]
  version: string
  online?: boolean
  lastSeen?: number
}

export interface TaskSpec {
  taskId: string
  originDeviceId: DeviceId
  targetDeviceId: DeviceId
  targetName?: string
  cwd: string
  prompt: string
  harness: HarnessKind
  model?: string
  approvalPolicy: ApprovalPolicy
  createdAt: number
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TaskSummary {
  taskId: string
  originDeviceId: DeviceId
  targetDeviceId: DeviceId
  targetName?: string
  cwd: string
  harness: HarnessKind
  prompt: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
  lastSeq: number
  stopReason?: string
}

export interface ApprovalOption {
  optionId: string
  name: string
  kind: string
}

export interface ApprovalRequest {
  approvalId: string
  taskId: string
  targetDeviceId: DeviceId
  targetName: string
  title: string
  detail?: string
  options: ApprovalOption[]
  at: number
}

export interface ApprovalResolved {
  approvalId: string
  taskId: string
  optionId: string
  byDeviceId: DeviceId
  byName: string
  at: number
}

export type SessionEvent =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'message'; text: string; at: number }
  | { kind: 'thought'; text: string; at: number }
  | {
      kind: 'tool'
      callId: string
      title: string
      status: 'pending' | 'in_progress' | 'completed' | 'failed'
      detail?: string
      at: number
    }
  | { kind: 'config'; model?: string; provider?: string; at: number }
  | { kind: 'context'; used?: number; size?: number; at: number }
  | { kind: 'permission'; approvalId: string; title: string; at: number }
  | { kind: 'end'; stopReason?: string; at: number }
  | { kind: 'error'; message: string; at: number }

// ---- wire: plaintext handshake ----

export interface HelloFrame {
  t: 'hello'
  v: number
  deviceId: DeviceId
  name: string
  platform: string
  edPub: string
  xPub: string
  nonce: string
}

export interface ChallengeFrame {
  t: 'challenge'
  v: number
  deviceId: DeviceId
  name: string
  platform: string
  edPub: string
  xPub: string
  nonce: string
  sig: string
}

export interface AuthFrame {
  t: 'auth'
  deviceId: DeviceId
  sig: string
}

export interface DeniedFrame {
  t: 'denied'
  reason: string
}

export type HandshakeFrame = HelloFrame | ChallengeFrame | AuthFrame | DeniedFrame

// ---- wire: encrypted mesh messages ----

export type MeshMessage =
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
  | { t: 'devices/snapshot'; devices: DeviceInfo[] }
  | { t: 'task/request'; task: TaskSpec }
  | { t: 'task/accepted'; taskId: string; at: number }
  | { t: 'task/rejected'; taskId: string; reason: string }
  | { t: 'task/event'; taskId: string; seq: number; event: SessionEvent }
  | { t: 'task/input'; taskId: string; text: string }
  | { t: 'task/cancel'; taskId: string }
  | { t: 'approval/request'; approval: ApprovalRequest }
  | { t: 'approval/respond'; approvalId: string; optionId: string }
  | { t: 'approval/resolved'; resolved: ApprovalResolved }
  | { t: 'error'; code: string; message: string; taskId?: string }

// ---- wire: local panel/CLI API (loopback, token authenticated) ----

export type LocalClientMessage =
  | { t: 'hello'; token: string }
  | { t: 'status' }
  | { t: 'devices/list' }
  | { t: 'tasks/list' }
  | {
      t: 'task/create'
      target: string
      cwd: string
      prompt: string
      harness?: HarnessKind
      model?: string
      approvalPolicy?: ApprovalPolicy
    }
  | { t: 'task/attach'; taskId: string; from?: number }
  | { t: 'task/input'; taskId: string; text: string }
  | { t: 'task/cancel'; taskId: string }
  | { t: 'approvals/list' }
  | { t: 'approval/respond'; approvalId: string; optionId: string }
  | { t: 'pair/create'; ttlMs?: number }
  | { t: 'pair/accept'; link: string }
  | { t: 'profile/sync' }

export type LocalServerMessage =
  | { t: 'hello'; device: DeviceInfo; version: string }
  | { t: 'error'; code: string; message: string; taskId?: string }
  | { t: 'devices'; devices: DeviceInfo[] }
  | { t: 'tasks'; tasks: TaskSummary[] }
  | { t: 'task'; task: TaskSummary }
  | { t: 'event'; taskId: string; seq: number; event: SessionEvent }
  | { t: 'approvals'; approvals: ApprovalRequest[] }
  | { t: 'approval/request'; approval: ApprovalRequest }
  | { t: 'approval/resolved'; resolved: ApprovalResolved }
  | { t: 'pairing'; link: string; code: string; expiresAt: number }
  | { t: 'ok'; op: string; value?: unknown }
