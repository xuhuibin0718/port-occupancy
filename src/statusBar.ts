import * as vscode from 'vscode';
import { OccupiedPort } from './types';
import { PortTreeProvider } from './tree';

export class PortStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscription: vscode.Disposable;

  constructor(provider: PortTreeProvider) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 8);
    this.item.command = 'portOccupancy.focus';
    this.subscription = provider.onDidChangePorts((ports) => this.render(ports));
    this.render(provider.currentPorts);
  }

  dispose(): void {
    this.item.dispose();
    this.subscription.dispose();
  }

  private render(ports: OccupiedPort[]): void {
    const show = vscode.workspace.getConfiguration('portOccupancy').get('showStatusBar', true);
    if (!show) {
      this.item.hide();
      return;
    }
    const listening = ports.filter((port) => port.state === 'LISTEN').length;
    this.item.text = `$(plug) ${listening}`;
    this.item.tooltip = vscode.l10n.t('{0} listening ports · click to open', String(listening));
    this.item.show();
  }
}
