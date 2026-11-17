import type { HarnessKind } from '@dsh-mesh/protocol'
import type { MeshConfig } from '../config.js'
import { AcpAdapter } from './acp.js'
import type { HarnessAdapter } from './types.js'

export function adapterFor(config: MeshConfig, kind: HarnessKind): HarnessAdapter {
  const command = config.harness[kind]
  if (!command) throw new Error(`harness "${kind}" is not configured on this device`)
  return new AcpAdapter(kind, command.command, command.args)
}
