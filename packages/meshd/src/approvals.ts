import type { ApprovalRequest, ApprovalResolved, DeviceId } from '@dsh-mesh/protocol'

interface Pending {
  request: ApprovalRequest
  resolve: (optionId: string | null) => void
  timer?: NodeJS.Timeout
}

export class ApprovalBroker {
  private pending = new Map<string, Pending>()

  ask(request: ApprovalRequest, timeoutMs = 15 * 60 * 1000): Promise<string | null> {
    return new Promise((resolve) => {
      const entry: Pending = { request, resolve }
      entry.timer = setTimeout(() => this.settle(request.approvalId, null), timeoutMs)
      this.pending.set(request.approvalId, entry)
    })
  }

  /** First responder wins; later answers are ignored. */
  respond(
    approvalId: string,
    optionId: string,
    byDeviceId: DeviceId,
    byName: string,
  ): ApprovalResolved | undefined {
    const entry = this.pending.get(approvalId)
    if (!entry) return undefined
    this.settle(approvalId, optionId)
    return {
      approvalId,
      taskId: entry.request.taskId,
      optionId,
      byDeviceId,
      byName,
      at: Date.now(),
    }
  }

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request)
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, null)
  }

  private settle(approvalId: string, optionId: string | null): void {
    const entry = this.pending.get(approvalId)
    if (!entry) return
    this.pending.delete(approvalId)
    if (entry.timer) clearTimeout(entry.timer)
    entry.resolve(optionId)
  }
}
