import * as vscode from 'vscode';
import { isEditorProcess, isProtectedProcess, killProcess, KillTarget } from './kill';
import { OccupiedPort } from './types';
import { PortItem, PortTreeProvider, ProcessItem, TreeNode } from './tree';

export function registerCommands(
  provider: PortTreeProvider,
  treeView: vscode.TreeView<TreeNode>,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('portOccupancy.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('portOccupancy.focus', () =>
      vscode.commands.executeCommand('portOccupancy.ports.focus'),
    ),
    vscode.commands.registerCommand('portOccupancy.filter', () => filterPorts(provider, treeView)),
    vscode.commands.registerCommand('portOccupancy.clearFilter', () => {
      provider.setFilter('');
      treeView.message = undefined;
    }),
    vscode.commands.registerCommand('portOccupancy.groupByProcess', () => provider.setGroupBy('process')),
    vscode.commands.registerCommand('portOccupancy.groupByPort', () => provider.setGroupBy('port')),
    vscode.commands.registerCommand('portOccupancy.findPort', () => findPort(provider, treeView)),
    vscode.commands.registerCommand('portOccupancy.killPort', () => killByPortNumber(provider)),
    vscode.commands.registerCommand('portOccupancy.kill', (item?: TreeNode) => killFromItem(provider, item)),
    vscode.commands.registerCommand('portOccupancy.copyPort', (item?: PortItem) => copy(item?.info.port)),
    vscode.commands.registerCommand('portOccupancy.copyPid', (item?: TreeNode) => copy(pidOf(item))),
    vscode.commands.registerCommand('portOccupancy.copyAddress', (item?: PortItem) =>
      copy(item ? `${item.info.localAddress}:${item.info.port}` : undefined),
    ),
    vscode.commands.registerCommand('portOccupancy.copyCommand', (item?: TreeNode) =>
      copy(commandOf(item, provider)),
    ),
    vscode.commands.registerCommand('portOccupancy.openInBrowser', (item?: PortItem) => openInBrowser(item)),
    vscode.commands.registerCommand('portOccupancy.copyAll', () => copyAll(provider)),
  ];
}

async function filterPorts(provider: PortTreeProvider, treeView: vscode.TreeView<TreeNode>): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: vscode.l10n.t('Filter occupied ports'),
    prompt: vscode.l10n.t('Filter by port, PID, process, or address'),
    value: provider.currentFilter,
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return;
  }
  provider.setFilter(value);
    treeView.message = value.trim()
      ? vscode.l10n.t('Filtered by "{0}"', value.trim())
      : undefined;
}

async function findPort(provider: PortTreeProvider, treeView: vscode.TreeView<TreeNode>): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: vscode.l10n.t('Find port'),
    prompt: vscode.l10n.t('Enter a port number'),
    validateInput: (text) => (/^\d+$/.test(text) && Number(text) <= 65535 ? undefined : vscode.l10n.t('Enter a valid port (0–65535)')),
    ignoreFocusOut: true,
  });
  if (!value) {
    return;
  }
  await provider.refresh();
  const port = Number.parseInt(value, 10);
  const item = provider.findPort(port);
  if (!item) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Nothing is using port {0}.', value));
    return;
  }
  const parent = provider.getParent(item);
  if (parent) {
    await treeView.reveal(parent, { expand: true });
  }
  await treeView.reveal(item, { select: true, focus: true });
}

async function killByPortNumber(provider: PortTreeProvider): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: vscode.l10n.t('Free a port'),
    prompt: vscode.l10n.t('Enter the port whose process should be stopped'),
    validateInput: (text) => (/^\d+$/.test(text) && Number(text) <= 65535 ? undefined : vscode.l10n.t('Enter a valid port (0–65535)')),
    ignoreFocusOut: true,
  });
  if (!value) {
    return;
  }
  await provider.refresh();
  const port = Number.parseInt(value, 10);
  const matches = provider.currentPorts.filter((item) => item.port === port && item.pid > 0);
  if (matches.length === 0) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Nothing is using port {0}.', value));
    return;
  }
  const uniquePids = uniqueTargets(matches);
  for (const target of uniquePids) {
    const stopped = await confirmAndKill(target);
    if (!stopped) {
      return;
    }
  }
  await provider.refresh();
}

async function killFromItem(provider: PortTreeProvider, item?: TreeNode): Promise<void> {
  const target = targetFromItem(item);
  if (!target) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Select a process or port first.'));
    return;
  }
  const stopped = await confirmAndKill(target);
  if (stopped) {
    await provider.refresh();
  }
}

function targetFromItem(item?: TreeNode): KillTarget | undefined {
  if (item instanceof ProcessItem) {
    return {
      pid: item.pid,
      processName: item.processName,
      ports: [...new Set(item.ports.map((port) => port.port))],
    };
  }
  if (item instanceof PortItem) {
    return {
      pid: item.info.pid,
      processName: item.info.processName,
      ports: [item.info.port],
    };
  }
  return undefined;
}

async function confirmAndKill(target: KillTarget): Promise<boolean> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Stopping processes is disabled in untrusted workspaces.'));
    return false;
  }

  const blocked = isProtectedProcess(target);
  if (blocked) {
    void vscode.window.showErrorMessage(blocked);
    return false;
  }

  const config = vscode.workspace.getConfiguration('portOccupancy');
  const force = config.get('forceKill', false);
  const confirm = config.get('confirmKill', true);
  const portList = target.ports.map((port) => `:${port}`).join(', ');

  if (confirm) {
    const buttons = [vscode.l10n.t('Stop Process')];
    const extra = isEditorProcess(target.processName)
      ? vscode.l10n.t('This looks like the editor process. Stopping it will quit Cursor/VS Code.')
      : '';
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Stop {0} (PID {1})? This frees {2}.',
        target.processName,
        String(target.pid),
        portList || vscode.l10n.t('its sockets'),
      ) + (extra ? `\n${extra}` : ''),
      { modal: true },
      ...buttons,
    );
    if (choice !== buttons[0]) {
      return false;
    }
  }

  try {
    await killProcess(target.pid, force);
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Stopped {0} (PID {1}).', target.processName, String(target.pid)),
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(vscode.l10n.t('Failed to stop PID {0}: {1}', String(target.pid), message));
    return false;
  }
}

function uniqueTargets(ports: OccupiedPort[]): KillTarget[] {
  const map = new Map<number, KillTarget>();
  for (const port of ports) {
    const existing = map.get(port.pid);
    if (existing) {
      if (!existing.ports.includes(port.port)) {
        existing.ports.push(port.port);
      }
    } else {
      map.set(port.pid, {
        pid: port.pid,
        processName: port.processName,
        ports: [port.port],
      });
    }
  }
  return [...map.values()];
}

async function copy(value: string | number | undefined): Promise<void> {
  if (value === undefined || value === '') {
    return;
  }
  await vscode.env.clipboard.writeText(String(value));
  void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied {0}', String(value)), 2000);
}

function pidOf(item?: TreeNode): number | undefined {
  if (item instanceof ProcessItem) {
    return item.pid;
  }
  if (item instanceof PortItem) {
    return item.info.pid;
  }
  return undefined;
}

function commandOf(item: TreeNode | undefined, provider: PortTreeProvider): string | undefined {
  if (item instanceof PortItem) {
    return item.info.commandLine;
  }
  if (item instanceof ProcessItem) {
    return item.ports[0]?.commandLine ?? provider.currentPorts.find((port) => port.pid === item.pid)?.commandLine;
  }
  return undefined;
}

async function openInBrowser(item?: PortItem): Promise<void> {
  if (!item) {
    return;
  }
  const host =
    item.info.localAddress === '0.0.0.0' ||
    item.info.localAddress === '::' ||
    item.info.localAddress === '*' ||
    item.info.localAddress === '::1'
      ? '127.0.0.1'
      : item.info.localAddress === '127.0.0.1'
        ? '127.0.0.1'
        : item.info.localAddress;
  const url = vscode.Uri.parse(`http://${host.includes(':') ? `[${host}]` : host}:${item.info.port}`);
  await vscode.env.openExternal(url);
}

async function copyAll(provider: PortTreeProvider): Promise<void> {
  const lines = [
    'port\ttransport\taddress\tstate\tpid\tprocess',
    ...provider.currentPorts.map((port) =>
      [port.port, port.transport, port.localAddress, port.state, port.pid, port.processName].join('\t'),
    ),
  ];
  await vscode.env.clipboard.writeText(lines.join('\n'));
  void vscode.window.setStatusBarMessage(
    vscode.l10n.t('Copied {0} ports', String(provider.currentPorts.length)),
    2000,
  );
}
