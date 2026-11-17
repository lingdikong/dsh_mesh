# Device Mesh

Adds a **Devices** page to DeepSeek Harness. Each machine runs `dsh-meshd`; the
panel shows every paired device, dispatches tasks to them, mirrors their event
stream, and surfaces approvals that any device can answer first.

## Requirements

- `dsh-meshd` running on this machine (`meshd up`), and on the devices you want
  to command.
- Devices paired with `meshd pair` / `meshd accept <link>`.

## What the page shows

- **Devices**: online state, addresses, harness availability.
- **Tasks**: dispatch a prompt to any device, with a working directory and a
  harness (`dsh`, `opencode`).
- **Mirror**: live messages, tool calls, context usage, and a follow-up input.
- **Approvals**: mesh-wide requests; the first answer wins and every other
  device closes the card.

## Model tools

The bundle also registers `mesh_devices`, `mesh_task`, `mesh_task_status`, and
`mesh_task_input`, so the local agent can delegate from chat.
