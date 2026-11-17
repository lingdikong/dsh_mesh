import type { ApprovalOption, SessionEvent, TaskSpec } from '@dsh-mesh/protocol'

export interface AdapterHooks {
  onEvent(event: SessionEvent): void
  /** Resolves to the chosen optionId, or null when cancelled/unavailable. */
  onApproval(input: { title: string; detail?: string; options: ApprovalOption[] }): Promise<string | null>
}

export interface TaskHandle {
  /** One prompt turn. Resolves with the adapter's stop reason. */
  prompt(text: string): Promise<string | undefined>
  cancel(): void
  close(): Promise<void>
}

export interface HarnessAdapter {
  readonly kind: string
  start(spec: TaskSpec, hooks: AdapterHooks): Promise<TaskHandle>
}
