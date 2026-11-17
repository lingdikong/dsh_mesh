window.__ModuleLoader__.load({
  id: 'dsh-mesh-panel',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const PANEL = 'mesh'
    const PLUGIN = 'dsh-mesh-panel'

    const CSS = `
.dshm-root{display:flex;flex-direction:column;height:100%;min-height:0;padding:16px;gap:12px;color:inherit}
.dshm-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dshm-title{font-weight:600;font-size:15px}
.dshm-sub{opacity:.6;font-size:12px}
.dshm-btn{appearance:none;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
.dshm-btn:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
.dshm-btn:disabled{opacity:.45;cursor:default}
.dshm-btn.primary{background:color-mix(in srgb,currentColor 14%,transparent)}
.dshm-pair{margin-top:6px;display:flex;flex-direction:column;gap:6px;font-size:12px}
.dshm-pair textarea{width:100%;height:52px;font-family:inherit;font-size:11px;resize:vertical;background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:6px;padding:6px}
.dshm-body{display:flex;gap:14px;flex:1;min-height:0}
.dshm-aside{width:330px;min-width:280px;display:flex;flex-direction:column;gap:10px;overflow:auto;padding-right:4px}
.dshm-card{border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.dshm-card h3{margin:0;font-size:12px;font-weight:600;opacity:.75;letter-spacing:.04em;text-transform:uppercase}
.dshm-device{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;border-bottom:1px solid color-mix(in srgb,currentColor 8%,transparent)}
.dshm-device:last-child{border-bottom:none}
.dshm-dot{width:8px;height:8px;border-radius:50%;background:currentColor;opacity:.25;flex:0 0 auto}
.dshm-dot.on{opacity:.9}
.dshm-device .meta{margin-left:auto;font-size:11px;opacity:.5;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshm-field{display:flex;flex-direction:column;gap:4px;font-size:12px}
.dshm-field input,.dshm-field select,.dshm-field textarea{background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:6px;padding:6px;font:inherit;font-size:12px}
.dshm-field textarea{min-height:64px;resize:vertical}
.dshm-task{padding:7px 8px;border-radius:8px;cursor:pointer;display:flex;flex-direction:column;gap:3px;font-size:12px;border:1px solid transparent}
.dshm-task:hover{background:color-mix(in srgb,currentColor 6%,transparent)}
.dshm-task.active{border-color:color-mix(in srgb,currentColor 25%,transparent);background:color-mix(in srgb,currentColor 8%,transparent)}
.dshm-task .row{display:flex;gap:8px;align-items:center}
.dshm-task .prompt{opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshm-badge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);opacity:.8;margin-left:auto}
.dshm-main{flex:1;min-width:0;display:flex;flex-direction:column;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:10px;overflow:hidden}
.dshm-main-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent);font-size:12px}
.dshm-events{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.dshm-empty{opacity:.5;font-size:13px;margin:auto}
.dshm-msg{white-space:pre-wrap;font-size:13px;line-height:1.5}
.dshm-user{white-space:pre-wrap;font-size:13px;line-height:1.5;opacity:.85;border-left:2px solid color-mix(in srgb,currentColor 30%,transparent);padding-left:8px}
.dshm-thought{white-space:pre-wrap;font-size:12px;opacity:.45;font-style:italic}
.dshm-tool{font-size:12px;display:flex;flex-direction:column;gap:4px}
.dshm-tool .row{display:flex;gap:8px;align-items:center}
.dshm-tool .status{opacity:.5;font-size:11px}
.dshm-tool pre{margin:0;padding:6px 8px;border-radius:6px;background:color-mix(in srgb,currentColor 6%,transparent);white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto}
.dshm-end{font-size:11px;opacity:.5}
.dshm-error{font-size:12px;color:#d9534f;white-space:pre-wrap}
.dshm-foot{display:flex;gap:8px;padding:10px 12px;border-top:1px solid color-mix(in srgb,currentColor 12%,transparent)}
.dshm-foot input{flex:1;background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;padding:7px 10px;font:inherit;font-size:12px}
.dshm-approvals{display:flex;flex-direction:column;gap:8px}
.dshm-approval{border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;font-size:12px;background:color-mix(in srgb,currentColor 5%,transparent)}
.dshm-approval .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dshm-err{font-size:12px;color:#d9534f}
`

    function post(path, body) {
      return fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
        return data
      })
    }

    function EventRow({ event }) {
      switch (event.kind) {
        case 'user':
          return h('div', { className: 'dshm-user' }, event.text)
        case 'message':
          return h('div', { className: 'dshm-msg' }, event.text)
        case 'thought':
          return h('div', { className: 'dshm-thought' }, event.text)
        case 'tool':
          return h(
            'div',
            { className: 'dshm-tool' },
            h(
              'div',
              { className: 'row' },
              h('strong', null, event.title || 'tool'),
              h('span', { className: 'status' }, event.status),
            ),
            event.detail ? h('pre', null, event.detail) : null,
          )
        case 'permission':
          return h('div', { className: 'dshm-tool' }, h('span', null, `等待审批：${event.title}`))
        case 'end':
          return h('div', { className: 'dshm-end' }, `结束 · ${event.stopReason || 'done'}`)
        case 'error':
          return h('div', { className: 'dshm-error' }, event.message)
        default:
          return null
      }
    }

    function DeviceList({ devices, self }) {
      return h(
        'div',
        { className: 'dshm-card' },
        h('h3', null, '设备'),
        devices.map((device) =>
          h(
            'div',
            { className: 'dshm-device', key: device.deviceId },
            h('span', { className: `dshm-dot${device.online ? ' on' : ''}` }),
            h('span', null, device.name + (device.deviceId === self.deviceId ? '（本机）' : '')),
            h('span', { className: 'meta', title: device.addresses.join(', ') }, device.addresses[0] || ''),
          ),
        ),
      )
    }

    function SendForm({ devices, onSend, busy }) {
      const [target, setTarget] = React.useState('')
      const [cwd, setCwd] = React.useState('')
      const [prompt, setPrompt] = React.useState('')
      const [harness, setHarness] = React.useState('dsh')
      const options = devices.map((device) => device.name)
      const chosen = target || options[0] || ''
      return h(
        'div',
        { className: 'dshm-card' },
        h('h3', null, '派发任务'),
        h(
          'div',
          { className: 'dshm-field' },
          h('label', null, '目标设备'),
          h(
            'select',
            { value: chosen, onChange: (event) => setTarget(event.target.value) },
            options.map((name) => h('option', { key: name, value: name }, name)),
          ),
        ),
        h(
          'div',
          { className: 'dshm-field' },
          h('label', null, '工作目录（目标设备上的绝对路径）'),
          h('input', {
            value: cwd,
            placeholder: '~/code/project 或 C:\\\\Users\\\\me\\\\project',
            onChange: (event) => setCwd(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'dshm-field' },
          h('label', null, '执行器'),
          h(
            'select',
            { value: harness, onChange: (event) => setHarness(event.target.value) },
            h('option', { value: 'dsh' }, 'dsh'),
            h('option', { value: 'opencode' }, 'opencode'),
          ),
        ),
        h(
          'div',
          { className: 'dshm-field' },
          h('label', null, '任务内容'),
          h('textarea', { value: prompt, onChange: (event) => setPrompt(event.target.value) }),
        ),
        h(
          'button',
          {
            className: 'dshm-btn primary',
            disabled: busy || !chosen || !prompt.trim() || !cwd.trim(),
            onClick: () => onSend({ target: chosen, cwd: cwd.trim(), prompt: prompt.trim(), harness }),
          },
          '派发',
        ),
      )
    }

    function TaskList({ tasks, selected, onSelect }) {
      return h(
        'div',
        { className: 'dshm-card' },
        h('h3', null, '任务'),
        tasks.length === 0 ? h('div', { className: 'dshm-sub' }, '还没有任务') : null,
        tasks.map((task) =>
          h(
            'div',
            {
              key: task.taskId,
              className: `dshm-task${selected === task.taskId ? ' active' : ''}`,
              onClick: () => onSelect(task.taskId),
            },
            h(
              'div',
              { className: 'row' },
              h('span', null, task.targetName || task.targetDeviceId.slice(0, 8)),
              h('span', { className: 'dshm-badge' }, task.status),
            ),
            h('div', { className: 'prompt', title: task.prompt }, task.prompt),
          ),
        ),
      )
    }

    function TaskView({ task, events, onStop, onInput }) {
      const [text, setText] = React.useState('')
      const running = task && (task.status === 'running' || task.status === 'queued')
      return h(
        'div',
        { className: 'dshm-main' },
        h(
          'div',
          { className: 'dshm-main-head' },
          h('strong', null, task ? task.targetName || task.targetDeviceId : '任务'),
          task ? h('span', { className: 'dshm-sub' }, `${task.harness} · ${task.status}`) : null,
          h('span', { style: { flex: 1 } }),
          running
            ? h('button', { className: 'dshm-btn', onClick: () => onStop(task.taskId) }, '停止')
            : null,
        ),
        h(
          'div',
          { className: 'dshm-events' },
          !task
            ? h('div', { className: 'dshm-empty' }, '选择左侧任务查看实时输出，或派发一个新任务')
            : events.length === 0
              ? h('div', { className: 'dshm-empty' }, '等待事件…')
              : events.map((entry) => h(EventRow, { key: entry.seq, event: entry.event })),
        ),
        task
          ? h(
              'div',
              { className: 'dshm-foot' },
              h('input', {
                value: text,
                placeholder: '追加指令（任务结束后会作为下一轮）',
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && text.trim()) {
                    onInput(task.taskId, text.trim())
                    setText('')
                  }
                },
              }),
              h(
                'button',
                {
                  className: 'dshm-btn',
                  disabled: !text.trim(),
                  onClick: () => {
                    onInput(task.taskId, text.trim())
                    setText('')
                  },
                },
                '发送',
              ),
            )
          : null,
      )
    }

    function Approvals({ approvals, onRespond }) {
      if (approvals.length === 0) return null
      return h(
        'div',
        { className: 'dshm-approvals' },
        approvals.map((approval) =>
          h(
            'div',
            { className: 'dshm-approval', key: approval.approvalId },
            h('div', null, h('strong', null, `审批 · ${approval.targetName}`), ' ', approval.title),
            h(
              'div',
              { className: 'row' },
              approval.options.map((option) =>
                h(
                  'button',
                  {
                    key: option.optionId,
                    className: 'dshm-btn primary',
                    onClick: () => onRespond(approval.approvalId, option.optionId),
                  },
                  option.name,
                ),
              ),
            ),
          ),
        ),
      )
    }

    function MeshPage() {
      const [selected, setSelected] = React.useState(null)
      const [snapshot, setSnapshot] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [pairing, setPairing] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        let timer
        async function poll() {
          try {
            const query = selected ? `?taskId=${encodeURIComponent(selected)}&from=1` : ''
            const response = await fetch(`/mesh/snapshot${query}`, { headers: { accept: 'application/json' } })
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
            if (alive) {
              setSnapshot(body)
              setError(null)
            }
          } catch (cause) {
            if (alive) setError(cause instanceof Error ? cause.message : String(cause))
          }
          if (alive) timer = setTimeout(poll, 1500)
        }
        poll()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [selected])

      const devices = snapshot?.devices ?? []
      const tasks = snapshot?.tasks ?? []
      const approvals = snapshot?.approvals ?? []
      const events = snapshot?.events ?? []
      const self = snapshot?.device ?? { deviceId: '', name: '本机' }
      const task = tasks.find((entry) => entry.taskId === selected)

      const send = async (input) => {
        setBusy(true)
        try {
          const created = await post('/mesh/tasks', input)
          setSelected(created.taskId)
          setError(null)
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }
      const stop = (taskId) => {
        post(`/mesh/tasks/${encodeURIComponent(taskId)}/cancel`).catch((cause) => setError(cause.message))
      }
      const input = (taskId, text) => {
        post(`/mesh/tasks/${encodeURIComponent(taskId)}/input`, { text }).catch((cause) => setError(cause.message))
      }
      const respond = (approvalId, optionId) => {
        post(`/mesh/approvals/${encodeURIComponent(approvalId)}/respond`, { optionId }).catch((cause) =>
          setError(cause.message),
        )
      }
      const pair = () => {
        post('/mesh/pair/create', {})
          .then(setPairing)
          .catch((cause) => setError(cause.message))
      }

      return h(
        'div',
        { className: 'dshm-root' },
        h(
          'div',
          { className: 'dshm-head' },
          h('span', { className: 'dshm-title' }, '设备网格'),
          h('span', { className: 'dshm-sub' }, self.name),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dshm-btn', onClick: pair }, '生成配对链接'),
        ),
        pairing
          ? h(
              'div',
              { className: 'dshm-pair' },
              h('div', null, `配对码 ${pairing.code} · 在另一台设备执行 meshd accept <link>`),
              h('textarea', { readOnly: true, value: pairing.link }),
            )
          : null,
        error ? h('div', { className: 'dshm-err' }, error) : null,
        h(Approvals, { approvals, onRespond: respond }),
        h(
          'div',
          { className: 'dshm-body' },
          h(
            'div',
            { className: 'dshm-aside' },
            h(DeviceList, { devices, self }),
            h(SendForm, { devices, onSend: send, busy }),
            h(TaskList, { tasks, selected, onSelect: setSelected }),
          ),
          h(TaskView, { task, events, onStop: stop, onInput: input }),
        ),
      )
    }

    function MeshIcon() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 36 36', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 18, cy: 8, r: 4.5, fill: 'currentColor' }),
        h('circle', { cx: 8, cy: 26, r: 4.5, fill: 'currentColor', opacity: 0.75 }),
        h('circle', { cx: 28, cy: 26, r: 4.5, fill: 'currentColor', opacity: 0.75 }),
        h('path', {
          d: 'M18 12.5 10 21.5M18 12.5l8 9M12.5 26h11',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          opacity: 0.6,
        }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = PLUGIN
          style.textContent = CSS
          document.head.append(style)
          return () => style.remove()
        })
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL }, MeshPage),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL, order: 50, label: () => '设备' },
            MeshIcon,
          ),
        )
      },
    }
  },
})
