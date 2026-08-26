import { runCommand } from './exec';

const PROTECTED_PIDS = new Set([0, 1, 2, 4]);
const PROTECTED_NAMES = /^(kernel_task|launchd|systemd|init|csrss|smss|wininit|services|lsass|svchost|System)$/i;
const EDITOR_NAMES = /^(Cursor|Code|Code - Insiders|Cursor Helper|Code Helper|Electron)$/i;

export interface KillTarget {
  pid: number;
  processName: string;
  ports: number[];
}

export function isProtectedProcess(target: KillTarget): string | undefined {
  if (!Number.isInteger(target.pid) || target.pid <= 0) {
    return 'Invalid process ID.';
  }
  if (PROTECTED_PIDS.has(target.pid) || target.pid === process.pid) {
    return 'Refusing to stop a system or extension-host process.';
  }
  if (PROTECTED_NAMES.test(target.processName)) {
    return `Refusing to stop protected process "${target.processName}".`;
  }
  return undefined;
}

export function isEditorProcess(processName: string): boolean {
  return EDITOR_NAMES.test(processName);
}

export async function killProcess(pid: number, force: boolean): Promise<void> {
  if (process.platform === 'win32') {
    const args = ['/PID', String(pid)];
    if (force) {
      args.push('/F');
    }
    await runCommand('taskkill', args);
    return;
  }

  await runCommand('kill', [force ? '-9' : '-TERM', String(pid)]);
}
