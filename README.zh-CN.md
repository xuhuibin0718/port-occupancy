[English](./README.md) | **简体中文**

# 端口占用

在编辑器里查看本机端口被哪个进程占用，并可以释放端口。

适用于 **Visual Studio Code** 和 **Cursor**，支持 macOS、Linux、Windows。界面语言随编辑器（English / 简体中文）。

## 功能

- 侧边栏列出占用中的端口（协议、地址、状态、PID、进程）
- 按进程或按端口分组
- 按端口、PID、进程名或地址筛选
- 查找占用指定端口的进程
- 复制端口、PID、地址、命令行，或整份列表
- 在浏览器中打开正在监听的 HTTP 端口
- 结束占用进程（需确认；受限模式不可用）
- 状态栏显示监听端口数量
- 可选自动刷新

扩展只读取本机端口表（`lsof` / `ss` / `Get-NetTCPConnection`），不会向外部发送数据。

## 安装

- VS Code / Cursor：在扩展视图中搜索 **Port Occupancy**
- 或打开命令面板 → **从 VSIX 安装扩展…**，选择 `.vsix` 文件

## 命令

| 命令 | 作用 |
| --- | --- |
| 端口占用: 刷新端口 | 重新扫描占用端口 |
| 端口占用: 查找占用某端口的进程… | 在列表中跳转到该端口 |
| 端口占用: 释放端口… | 结束监听该端口的进程 |
| 端口占用: 筛选端口 | 筛选侧边栏列表 |
| 端口占用: 复制端口列表 | 复制全部端口的 TSV 表格 |

右键某一行可以复制信息、在浏览器打开 `localhost`，或结束进程。

## 设置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `portOccupancy.showUdp` | `true` | 包含 UDP 端口 |
| `portOccupancy.showEstablished` | `false` | 同时列出已建立的 TCP 连接 |
| `portOccupancy.groupBy` | `process` | `process` 或 `port` |
| `portOccupancy.refreshInterval` | `0` | 自动刷新间隔（秒）；`0` 表示仅手动刷新 |
| `portOccupancy.confirmKill` | `true` | 结束进程前确认 |
| `portOccupancy.forceKill` | `false` | 强制结束（`SIGKILL` / `taskkill /F`） |
| `portOccupancy.ignoredProcesses` | `[]` | 要从列表中隐藏的进程名 |
| `portOccupancy.ignoredPorts` | `[]` | 要从列表中隐藏的端口号 |
| `portOccupancy.showStatusBar` | `true` | 在状态栏显示监听端口数量 |

## 运行环境

- **macOS**：`lsof`（系统自带）
- **Linux**：`ss`（iproute2）或 `lsof`
- **Windows**：PowerShell `Get-NetTCPConnection`，失败时回退到 `netstat`

部分系统端口只有在编辑器有权查看其他用户进程时才会出现。列表会显示当前用户能看到的全部占用。

结束进程无法撤销。系统进程和编辑器自身会被拦截；其他进程仍会要求确认。
