import { runCommand } from './exec';
import { normalizeState, parseLsofFields, parseNetstatWindows, parseSs, processNameFromArgs } from './parse';
import { makePortId, OccupiedPort, ScanOptions, ScanResult } from './types';

const LSOF_FIELDS = ['-nP', '-F', 'cpnPuT'];

export async function scanPorts(options: ScanOptions): Promise<ScanResult> {
  const platform = process.platform;
  let warning: string | undefined;
  let ports: OccupiedPort[] = [];

  try {
    if (platform === 'win32') {
      const result = await scanWindows(options);
      ports = result.ports;
      warning = result.warning;
    } else if (platform === 'linux') {
      const result = await scanLinux(options);
      ports = result.ports;
      warning = result.warning;
    } else {
      const result = await scanUnixLsof(options);
      ports = result.ports;
      warning = result.warning;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ports: [], warning: message };
  }

  ports = await enrichProcessNames(ports);
  ports = dedupe(filterPorts(ports, options));
  ports.sort((a, b) => a.port - b.port || a.pid - b.pid || a.transport.localeCompare(b.transport));
  return { ports, warning };
}

function filterPorts(ports: OccupiedPort[], options: ScanOptions): OccupiedPort[] {
  const ignoredProcesses = new Set(options.ignoredProcesses.map((name) => name.toLowerCase()));
  const ignoredPorts = new Set(options.ignoredPorts);

  return ports.filter((port) => {
    if (!options.showUdp && port.transport === 'udp') {
      return false;
    }
    if (!options.showEstablished && port.state !== 'LISTEN' && port.transport === 'tcp') {
      return false;
    }
    if (ignoredPorts.has(port.port)) {
      return false;
    }
    if (ignoredProcesses.has(port.processName.toLowerCase())) {
      return false;
    }
    return true;
  });
}

function dedupe(ports: OccupiedPort[]): OccupiedPort[] {
  const seen = new Set<string>();
  const result: OccupiedPort[] = [];
  for (const port of ports) {
    if (seen.has(port.id)) {
      continue;
    }
    seen.add(port.id);
    result.push(port);
  }
  return result;
}

async function scanUnixLsof(options: ScanOptions): Promise<ScanResult> {
  const chunks: string[] = [];
  const commands: Array<Promise<string>> = [
    runCommand('lsof', ['-iTCP', '-sTCP:LISTEN', ...LSOF_FIELDS]),
  ];
  if (options.showEstablished) {
    commands.push(runCommand('lsof', ['-iTCP', '-sTCP:ESTABLISHED', ...LSOF_FIELDS]));
  }
  if (options.showUdp) {
    commands.push(runCommand('lsof', ['-iUDP', ...LSOF_FIELDS]));
  }

  try {
    const outputs = await Promise.all(commands);
    chunks.push(...outputs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ports: [],
      warning: `lsof failed (${message}). On macOS/Linux install lsof to list occupied ports.`,
    };
  }

  return { ports: chunks.flatMap(parseLsofFields) };
}

async function scanLinux(options: ScanOptions): Promise<ScanResult> {
  const args = ['-H', '-n', '-p', '-t'];
  if (options.showUdp) {
    args.push('-u');
  }
  args.push(options.showEstablished ? '-a' : '-l');

  try {
    const output = await runCommand('ss', args);
    const ports = parseSs(output);
    if (ports.length > 0) {
      return { ports };
    }
  } catch {
    // Fall through to lsof.
  }

  return scanUnixLsof(options);
}

interface WindowsJsonRow {
  protocol?: string;
  localAddress?: string;
  localPort?: number;
  remoteAddress?: string;
  remotePort?: number;
  state?: string;
  pid?: number;
  processName?: string;
}

async function scanWindows(options: ScanOptions): Promise<ScanResult> {
  try {
    const json = await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      windowsScript(options),
    ]);
    const rows = JSON.parse(json || '[]') as WindowsJsonRow[] | WindowsJsonRow;
    const list = Array.isArray(rows) ? rows : [rows];
    const ports: OccupiedPort[] = [];
    for (const row of list) {
      if (row.localPort == null || !row.protocol) {
        continue;
      }
      const transport = row.protocol.toLowerCase() === 'udp' ? 'udp' : 'tcp';
      const localAddress = row.localAddress || '0.0.0.0';
      const entry: OccupiedPort = {
        id: '',
        transport,
        ipVersion: localAddress.includes(':') ? 6 : 4,
        localAddress,
        port: Number(row.localPort),
        remoteAddress: row.remoteAddress || undefined,
        remotePort: row.remotePort ? Number(row.remotePort) : undefined,
        state: normalizeState(row.state, transport),
        pid: Number(row.pid) || 0,
        processName: row.processName || 'unknown',
      };
      entry.id = makePortId(entry);
      ports.push(entry);
    }
    return { ports };
  } catch {
    return scanWindowsNetstat();
  }
}

function windowsScript(options: ScanOptions): string {
  const includeUdp = options.showUdp ? '$true' : '$false';
  const includeEstablished = options.showEstablished ? '$true' : '$false';
  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$rows = @()
$tcp = Get-NetTCPConnection
foreach ($c in $tcp) {
  $state = $c.State.ToString()
  if (-not ${includeEstablished} -and $state -ne 'Listen') { continue }
  $name = ''
  try { $name = (Get-Process -Id $c.OwningProcess).ProcessName } catch {}
  $rows += [pscustomobject]@{
    protocol = 'tcp'
    localAddress = $c.LocalAddress
    localPort = $c.LocalPort
    remoteAddress = $c.RemoteAddress
    remotePort = $c.RemotePort
    state = $state
    pid = $c.OwningProcess
    processName = $name
  }
}
if (${includeUdp}) {
  $udp = Get-NetUDPEndpoint
  foreach ($c in $udp) {
    $name = ''
    try { $name = (Get-Process -Id $c.OwningProcess).ProcessName } catch {}
    $rows += [pscustomobject]@{
      protocol = 'udp'
      localAddress = $c.LocalAddress
      localPort = $c.LocalPort
      remoteAddress = ''
      remotePort = 0
      state = 'Listen'
      pid = $c.OwningProcess
      processName = $name
    }
  }
}
$rows | ConvertTo-Json -Compress
`.trim();
}

async function scanWindowsNetstat(): Promise<ScanResult> {
  try {
    const output = await runCommand('netstat', ['-ano']);
    const ports = parseNetstatWindows(output);
    return {
      ports,
      warning: ports.length ? undefined : 'netstat returned no connections.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ports: [], warning: `Unable to list ports on Windows: ${message}` };
  }
}

async function enrichProcessNames(ports: OccupiedPort[]): Promise<OccupiedPort[]> {
  if (process.platform === 'win32') {
    return ports;
  }

  const pids = [...new Set(ports.map((port) => port.pid).filter((pid) => pid > 0))];
  if (pids.length === 0) {
    return ports;
  }

  const details = new Map<number, { name: string; commandLine: string }>();
  const chunkSize = 80;
  for (let i = 0; i < pids.length; i += chunkSize) {
    const chunk = pids.slice(i, i + chunkSize);
    try {
      const output = await runCommand('ps', ['-ww', '-o', 'pid=,args=', '-p', chunk.join(',')], {
        posixLocale: false,
      });
      for (const line of output.split(/\r?\n/)) {
        const match = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!match) {
          continue;
        }
        const pid = Number.parseInt(match[1], 10);
        const commandLine = match[2].trim();
        details.set(pid, {
          name: processNameFromArgs(commandLine),
          commandLine,
        });
      }
    } catch {
      // Keep lsof/ss short names.
    }
  }

  return ports.map((port) => {
    const extra = details.get(port.pid);
    if (!extra) {
      return port;
    }
    return {
      ...port,
      processName: extra.name || port.processName,
      commandLine: extra.commandLine,
    };
  });
}
