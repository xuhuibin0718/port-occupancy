import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { PortStatusBar } from './statusBar';
import { PortTreeProvider } from './tree';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PortTreeProvider(context);
  const treeView = vscode.window.createTreeView('portOccupancy.ports', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  treeView.title = vscode.l10n.t('Ports');

  const statusBar = new PortStatusBar(provider);

  context.subscriptions.push(
    provider,
    treeView,
    statusBar,
    ...registerCommands(provider, treeView),
  );

  void provider.refresh();
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions.
}
