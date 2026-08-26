# Port Occupancy

See which local ports are occupied, which process owns them, and free a port without leaving the editor.

Works in **Visual Studio Code** and **Cursor** on macOS, Linux, and Windows. The UI follows the editor language (English / 简体中文).

## Features

- Sidebar list of occupied ports (protocol, address, state, PID, process)
- Group by process or by port
- Filter by port, PID, process name, or address
- Command: find the process on a given port
- Copy port, PID, address, command line, or the full list
- Open a listening HTTP port in the browser
- Stop the owning process (with confirmation; disabled in Restricted Mode)
- Status bar count of listening ports
- Optional auto-refresh

The extension only reads local socket tables (`lsof` / `ss` / `Get-NetTCPConnection`). It does not send data anywhere.

## Install

### From the marketplace (after publish)

- VS Code: search **Port Occupancy** in Extensions
- Cursor: search the same name in the Extensions view, or install the VS Code Marketplace / Open VSX build

### From a VSIX (both editors)

1. Run `npm install` and `npm run package` in this folder, or download the `.vsix`
2. VS Code / Cursor: Command Palette → **Extensions: Install from VSIX…**
3. Pick `port-occupancy-1.0.0.vsix`
4. Reload the window

### Development

1. `npm install`
2. Press **F5** (Run Extension)
3. A new Extension Development Host window opens; look for the Port Occupancy icon in the activity bar

## Commands

| Command | What it does |
| --- | --- |
| Port Occupancy: Refresh Ports | Rescan occupied ports |
| Port Occupancy: Find Process on Port… | Jump to a port in the tree |
| Port Occupancy: Free Port… | Stop the process listening on a port |
| Port Occupancy: Filter Ports | Filter the sidebar list |
| Port Occupancy: Copy Port List | Copy a TSV table of all rows |

Right-click a row to copy details, open `localhost` in a browser, or stop the process.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `portOccupancy.showUdp` | `true` | Include UDP sockets |
| `portOccupancy.showEstablished` | `false` | Also list established TCP connections |
| `portOccupancy.groupBy` | `process` | `process` or `port` |
| `portOccupancy.refreshInterval` | `0` | Auto-refresh seconds; `0` is manual only |
| `portOccupancy.confirmKill` | `true` | Confirm before stopping a process |
| `portOccupancy.forceKill` | `false` | `SIGKILL` / `taskkill /F` |
| `portOccupancy.ignoredProcesses` | `[]` | Hide these process names |
| `portOccupancy.ignoredPorts` | `[]` | Hide these port numbers |
| `portOccupancy.showStatusBar` | `true` | Status bar listening-port count |

## Requirements

- **macOS**: `lsof` (installed by default)
- **Linux**: `ss` (iproute2) or `lsof`
- **Windows**: PowerShell `Get-NetTCPConnection`, with `netstat` as fallback

Some system sockets are only visible when the editor is allowed to inspect other users' processes. The list still shows everything the current user can see.

Stopping a process cannot be undone. System processes and the editor itself are blocked; other processes still ask for confirmation.

## 中文说明

侧边栏查看本机端口占用（进程、PID、协议、地址），支持筛选、查找、复制、浏览器打开，以及结束占用进程以释放端口。VS Code 与 Cursor 均可安装，macOS / Linux / Windows 可用。

受限模式（Untrusted Workspace）下只能查看，不能结束进程。扩展只在本机读取端口表，不会上传数据。
