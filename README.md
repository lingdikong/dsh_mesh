# dsh-mesh

在多台设备之间组成一个**设备网格**：任意一台设备上的 DeepSeek Harness Desktop（或终端）都可以指挥其他设备上的 agent 干活。

每台设备运行一个独立的守护进程 `meshd`，负责联机、执行与审批；DSH 插件 `dsh-mesh-panel` 只做控制面板与模型工具。因此守护进程不依赖 DSH 版本，也能直接驱动 `opencode` 等其他 harness。

## 能力

- **聊天里派活**：面板注册了 `mesh_devices` / `mesh_task` / `mesh_task_status` / `mesh_task_input` 四个模型工具，agent 可以直接把任务转给别的设备。
- **设备面板**：DSH 侧边栏新增「设备」页，查看在线设备、派发任务、镜像实时输出。
- **镜像/接管**：任意设备都能 attach 任一会话，看消息、工具调用、context 用量，并追加指令或停止。
- **全局审批**：需要授权的操作会广播到所有在线设备，**任意一台先响应即生效**，其余设备上的卡片立即消失。
- **局域网 + 虚拟专网**：mDNS 自动发现局域网设备，Tailscale/ZeroTier 地址在配对时一并写入。
- **端到端加密**：Ed25519 身份 + X25519 ECDH + AES-256-GCM，只与已配对公钥通信。

## 架构

```
┌──────────── DSH Desktop A ────────────┐        ┌──────────── DSH Desktop B ────────────┐
│ dsh-mesh-panel（Host 面 + Client 面） │        │ dsh-mesh-panel（Host 面 + Client 面） │
│        │ 同源 /mesh/* 或 127.0.0.1     │        │        │ 同源 /mesh/* 或 127.0.0.1     │
│        ▼                                │        │        ▼                                │
│   meshd (A)  ◀──── mesh WSS (加密) ────▶│  meshd (B) ◀── 同一协议，任意拓扑        │
│        │ ACP stdio                      │        │        │ ACP stdio                      │
│   dsh --profile mesh / opencode acp    │        │   dsh --profile mesh / opencode acp    │
└─────────────────────────────────────────┘        └─────────────────────────────────────────┘
```

- `meshd` 是唯一事实源：会话、事件序列（单调 `seq`）、审批状态都在守护进程，断线可按 `from=seq` 重放。
- 面板 ↔ meshd 只走回环：Host 面注册同源 `/mesh` 前缀路由并代为携带令牌，浏览器不接触令牌。
- 执行器通过 [Agent Client Protocol](https://agentclientprotocol.com) 驱动，DSH 用 `dsh --profile mesh`，opencode 用 `opencode acp`。

## 快速开始

需要 Node **22.18+**（本仓库用 pnpm）。

```bash
pnpm install
pnpm --filter @dsh-mesh/protocol build
pnpm --filter dsh-meshd build
pnpm --filter dsh-meshd bundle     # 产出单文件 dist/meshd.cjs
```

每台设备启动守护进程（默认数据目录 `~/.dsh-mesh`，mesh 端口 `47821`，面板端口 `47822`）：

```bash
node packages/meshd/dist/meshd.cjs up
# 或后台： node packages/meshd/dist/meshd.cjs up --daemon
```

配对（在 A 生成链接，在 B 接受；反向再做一次以互相认识）：

```bash
# A
meshd pair                     # 输出 6 位码 + dsh-mesh://pair/... 链接
# B
meshd accept '<link>'
```

派任务：

```bash
meshd devices
meshd send winB "跑一下测试并汇报结果" --cwd /path/on/B --harness dsh --wait
meshd attach <taskId>          # 实时看事件
meshd approvals                # 待审批
meshd approve <approvalId> <optionId>
```

Windows 上 SSH 会话结束会带走子进程，推荐用计划任务驻留（把命令写进 `meshd-b.cmd` 后 `schtasks /Create /TN dsh-mesh /TR ... /SC ONCE /ST 23:59 /F`，再 `schtasks /Run /TN dsh-mesh`）。

## DSH 面板安装

把本目录下的 `packages/dsh-mesh-panel` 装进 desktop profile：

```bash
dsh plugin --profile desktop add /absolute/path/to/packages/dsh-mesh-panel
```

或在 Desktop 里 **Plugins → Add plugin** 选择该目录。重启 Desktop 后，侧边栏出现「设备」页。

面板的 Host 面会注册同源 `/mesh/*` 代理（只接受回环 Host，并按 Origin 校验），并注册 4 个模型工具。

## CLI

```
meshd up [--daemon] [--name N] [--port 47821] [--panel-port 47822] [--home DIR] [--no-mdns]
meshd status | devices | approvals
meshd pair | accept <link>
meshd send <device> "<prompt>" [--cwd DIR] [--harness dsh|opencode] [--wait] [--json]
meshd attach <taskId> [--from SEQ]
meshd approve <approvalId> <optionId>
meshd sync-profile
```

## 配置

`~/.dsh-mesh/config.json`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `name` | 主机名 | 设备昵称 |
| `port` | `47821` | mesh 监听端口 |
| `bind` | `0.0.0.0` | 监听地址，可限定到 `en0`/`utun*` 对应地址 |
| `panelPort` | `47822` | 本地面板/CLI 端口（仅回环） |
| `profile` | `mesh` | DSH 执行器使用的 profile |
| `harness` | `dsh: dsh --profile mesh`，`opencode: opencode acp` | 各执行器的启动命令 |
| `allowedRoots` | `[$HOME]` | 远端任务允许的工作目录根 |
| `discovery.mdns` | `true` | 是否启用 mDNS 发现 |

`meshd` 首启会基于 `acp` 模板准备 `mesh` profile，并从 desktop profile 的 `agent-default-model` 复制 provider/model（例如 `dsh-opencode-go` / `deepseek-v4.1-flash`），随后 `meshd sync-profile` 可重复同步。

## 安全

- 仅已配对设备可握手；未配对连接直接拒绝并记录。
- 设备间消息加密，mDNS 只广播 deviceId。
- 面板 API 只监听 `127.0.0.1`，令牌存 `~/.dsh-mesh/panel-token`（0600）。
- 远端任务 `cwd` 必须落在目标机 `allowedRoots` 内。
- 审批单点裁决、幂等、失败关闭；无人应答按会话策略处理。
- ACP 客户端是被信任的控制器：**配对即授权**，不要把配对链接发给不信任的设备。

## 已知限制

- DSH 的 ACP 只发送**已提交**的消息/工具事件，没有逐字流；面板按消息级刷新。
- DSH ACP 不支持 `session/load`、fork、plans、terminals；恢复会话用 `session/resume`。
- 目前驱动的是 meshd 自己创建的会话；把 Desktop 里已有的会话登记进网格仍在路线图上。
- 跨平台路径按目标设备解析；请传目标设备上的绝对路径。

## 目录

```
packages/protocol/        帧定义、握手与加密、配对链接
packages/meshd/           守护进程、CLI、ACP 适配器、HTTP/WS API
packages/dsh-mesh-panel/  DSH 插件（Host 面代理 + 工具，Client 面设备页）
```

## License

MIT
