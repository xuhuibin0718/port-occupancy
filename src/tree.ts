import * as vscode from 'vscode';
import { scanPorts } from './scanner';
import { GroupBy, OccupiedPort, ScanOptions } from './types';

export type TreeNode = ProcessItem | PortItem;

export class ProcessItem extends vscode.TreeItem {
  constructor(
    readonly pid: number,
    readonly processName: string,
    readonly ports: OccupiedPort[],
  ) {
    super(processName, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'processItem';
    this.id = `process:${pid}:${processName}`;
    this.description = vscode.l10n.t('PID {0} · {1} ports', String(pid), String(ports.length));
    this.iconPath = new vscode.ThemeIcon('server-process');
    this.tooltip = new vscode.MarkdownString(
      [
        `**${processName}**`,
        `PID \`${pid}\``,
        ports[0]?.commandLine ? `\`${ports[0].commandLine}\`` : '',
        ports.map((port) => `- :${port.port} ${port.transport.toUpperCase()} ${port.localAddress}`).join('\n'),
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }
}

export class PortItem extends vscode.TreeItem {
  constructor(
    readonly info: OccupiedPort,
    readonly groupedByProcess: boolean,
  ) {
    const label = groupedByProcess
      ? `:${info.port}`
      : `:${info.port}  ${info.processName}`;
    super(label, vscode.TreeItemCollapsibleState.None);
    const listening = info.state === 'LISTEN';
    this.contextValue = listening ? 'portItem.listen' : 'portItem';
    this.id = `port:${info.id}`;
    this.description = groupedByProcess
      ? `${info.transport.toUpperCase()}  ${displayAddress(info.localAddress)}  ${info.state}`
      : `PID ${info.pid}  ${info.transport.toUpperCase()}  ${displayAddress(info.localAddress)}`;
    this.iconPath = new vscode.ThemeIcon(
      info.transport === 'udp' ? 'broadcast' : listening ? 'plug' : 'debug-disconnect',
      listening ? new vscode.ThemeColor('charts.green') : new vscode.ThemeColor('charts.yellow'),
    );
    this.tooltip = buildPortTooltip(info);
  }
}

export class PortTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _onDidChangePorts = new vscode.EventEmitter<OccupiedPort[]>();
  readonly onDidChangePorts = this._onDidChangePorts.event;

  private ports: OccupiedPort[] = [];
  private filterText = '';
  private groupBy: GroupBy = 'process';
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private scanning = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.groupBy = vscode.workspace.getConfiguration('portOccupancy').get<GroupBy>('groupBy', 'process');
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('portOccupancy')) {
          this.groupBy = vscode.workspace.getConfiguration('portOccupancy').get<GroupBy>('groupBy', 'process');
          this.scheduleAutoRefresh();
          void this.refresh();
        }
      }),
    );
    this.scheduleAutoRefresh();
  }

  get currentPorts(): OccupiedPort[] {
    return this.ports;
  }

  get currentFilter(): string {
    return this.filterText;
  }

  getParent(element: TreeNode): TreeNode | undefined {
    if (element instanceof PortItem && this.groupBy === 'process') {
      return this.getProcessItems().find((item) => item.pid === element.info.pid);
    }
    return undefined;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const filtered = this.filteredPorts();
    if (!element) {
      if (this.groupBy === 'process') {
        return this.getProcessItems(filtered);
      }
      return filtered.map((port) => new PortItem(port, false));
    }
    if (element instanceof ProcessItem) {
      return element.ports.map((port) => new PortItem(port, true));
    }
    return [];
  }

  async refresh(): Promise<void> {
    if (this.scanning) {
      return;
    }
    this.scanning = true;
    try {
      const result = await scanPorts(this.scanOptions());
      this.ports = result.ports;
      if (result.warning) {
        void vscode.window.showWarningMessage(result.warning);
      }
      this._onDidChangePorts.fire(this.ports);
      this._onDidChangeTreeData.fire(undefined);
    } finally {
      this.scanning = false;
    }
  }

  setFilter(value: string): void {
    this.filterText = value.trim();
    void vscode.commands.executeCommand('setContext', 'portOccupancy.hasFilter', Boolean(this.filterText));
    this._onDidChangeTreeData.fire(undefined);
  }

  setGroupBy(groupBy: GroupBy): void {
    this.groupBy = groupBy;
    void vscode.workspace.getConfiguration('portOccupancy').update('groupBy', groupBy, vscode.ConfigurationTarget.Global);
    this._onDidChangeTreeData.fire(undefined);
  }

  findPort(port: number): PortItem | undefined {
    const match = this.filteredPorts().find((item) => item.port === port);
    return match ? new PortItem(match, this.groupBy === 'process') : undefined;
  }

  findProcess(pid: number): ProcessItem | undefined {
    return this.getProcessItems().find((item) => item.pid === pid);
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this._onDidChangeTreeData.dispose();
    this._onDidChangePorts.dispose();
  }

  private filteredPorts(): OccupiedPort[] {
    const query = this.filterText.toLowerCase();
    if (!query) {
      return this.ports;
    }
    return this.ports.filter((port) => {
      const haystack = [
        String(port.port),
        String(port.pid),
        port.processName,
        port.localAddress,
        port.transport,
        port.state,
        port.commandLine ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  private getProcessItems(ports: OccupiedPort[] = this.filteredPorts()): ProcessItem[] {
    const groups = new Map<string, OccupiedPort[]>();
    for (const port of ports) {
      const key = `${port.pid}:${port.processName}`;
      const list = groups.get(key) ?? [];
      list.push(port);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .map(([key, grouped]) => {
        const pid = grouped[0]?.pid ?? Number(key.split(':')[0]);
        return new ProcessItem(pid, grouped[0]?.processName ?? 'unknown', grouped);
      })
      .sort((a, b) => a.processName.localeCompare(b.processName) || a.pid - b.pid);
  }

  private scanOptions(): ScanOptions {
    const config = vscode.workspace.getConfiguration('portOccupancy');
    return {
      showUdp: config.get('showUdp', true),
      showEstablished: config.get('showEstablished', false),
      ignoredProcesses: config.get<string[]>('ignoredProcesses', []),
      ignoredPorts: config.get<number[]>('ignoredPorts', []),
    };
  }

  private scheduleAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    const seconds = vscode.workspace.getConfiguration('portOccupancy').get<number>('refreshInterval', 0);
    if (seconds > 0) {
      this.refreshTimer = setInterval(() => {
        void this.refresh();
      }, seconds * 1000);
    }
  }
}

function displayAddress(address: string): string {
  if (address === '0.0.0.0' || address === '::' || address === '*') {
    return '*';
  }
  return address;
}

function buildPortTooltip(info: OccupiedPort): vscode.MarkdownString {
  const lines = [
    `**:${info.port}** · ${info.transport.toUpperCase()}/${info.ipVersion === 6 ? 'IPv6' : 'IPv4'}`,
    vscode.l10n.t('Process: {0} (PID {1})', info.processName, String(info.pid)),
    vscode.l10n.t('Address: {0}', info.localAddress),
    vscode.l10n.t('State: {0}', info.state),
  ];
  if (info.remoteAddress) {
    lines.push(vscode.l10n.t('Remote: {0}:{1}', info.remoteAddress, String(info.remotePort ?? '')));
  }
  if (info.commandLine) {
    lines.push(`\`${info.commandLine}\``);
  }
  return new vscode.MarkdownString(lines.join('\n\n'));
}
