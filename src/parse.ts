import { makePortId, OccupiedPort, Transport } from './types';

export function splitHostPort(value: string): { host: string; port: number } | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '*' || trimmed === '*:*') {
    return undefined;
  }

  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon <= 0 || lastColon === trimmed.length - 1) {
    return undefined;
  }

  const hostRaw = trimmed.slice(0, lastColon);
  const portRaw = trimmed.slice(lastColon + 1);
  if (!/^\d+$/.test(portRaw)) {
    return undefined;
  }

  const port = Number.parseInt(portRaw, 10);
  if (port < 0 || port > 65535) {
    return undefined;
  }

  const host = hostRaw.replace(/^\[/, '').replace(/\]$/, '');
  return { host, port };
}

export function detectIpVersion(address: string): 4 | 6 {
  return address.includes(':') ? 6 : 4;
}

export function normalizeState(state: string | undefined, transport: Transport): string {
  if (!state) {
    return transport === 'udp' ? 'LISTEN' : 'UNKNOWN';
  }
  const upper = state.replace(/[_-]/g, '').toUpperCase();
  const map: Record<string, string> = {
    LISTEN: 'LISTEN',
    LISTENING: 'LISTEN',
    ESTABLISHED: 'ESTABLISHED',
    CLOSEWAIT: 'CLOSE_WAIT',
    TIMEWAIT: 'TIME_WAIT',
    FINWAIT1: 'FIN_WAIT_1',
    FINWAIT2: 'FIN_WAIT_2',
    LASTACK: 'LAST_ACK',
    SYN_SENT: 'SYN_SENT',
    SYNSENT: 'SYN_SENT',
    SYN_RECV: 'SYN_RECV',
    SYNRECEIVED: 'SYN_RECV',
    SYN_RCVD: 'SYN_RECV',
    CLOSING: 'CLOSING',
    BOUND: 'BOUND',
  };
  return map[upper] ?? state.toUpperCase();
}

export function parseLsofName(name: string): {
  localAddress: string;
  port: number;
  remoteAddress?: string;
  remotePort?: number;
  state?: string;
} | undefined {
  const stateMatch = name.match(/\(([^)]+)\)\s*$/);
  const state = stateMatch?.[1];
  const rest = (stateMatch ? name.slice(0, stateMatch.index) : name).trim();
  if (!rest) {
    return undefined;
  }

  const [localPart, remotePart] = rest.split('->');
  const local = splitHostPort(localPart.replace(/^\*:/, '*:').replace(/^\[::\]/, '::'));
  if (!local) {
    return undefined;
  }

  const remote = remotePart ? splitHostPort(remotePart) : undefined;
  return {
    localAddress: local.host === '*' ? '0.0.0.0' : local.host,
    port: local.port,
    remoteAddress: remote?.host,
    remotePort: remote?.port,
    state,
  };
}

/**
 * Parse `lsof -F` machine-readable output.
 * Process records start with `p`; each open file starts with `f`.
 */
export function parseLsofFields(text: string): OccupiedPort[] {
  const results: OccupiedPort[] = [];
  let pid = 0;
  let command = '';
  let user = '';
  let protocol = '';
  let name = '';
  let state = '';

  const flushFile = () => {
    if (!pid || !name) {
      return;
    }
    const parsed = parseLsofName(name);
    if (!parsed) {
      return;
    }
    const transport: Transport = protocol.toLowerCase().includes('udp') ? 'udp' : 'tcp';
    const entry: OccupiedPort = {
      id: '',
      transport,
      ipVersion: detectIpVersion(parsed.localAddress),
      localAddress: parsed.localAddress,
      port: parsed.port,
      remoteAddress: parsed.remoteAddress,
      remotePort: parsed.remotePort,
      state: normalizeState(parsed.state ?? state, transport),
      pid,
      processName: command || 'unknown',
      user,
    };
    entry.id = makePortId(entry);
    results.push(entry);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine) {
      continue;
    }
    const field = rawLine[0];
    const value = rawLine.slice(1);
    switch (field) {
      case 'p':
        flushFile();
        pid = Number.parseInt(value, 10) || 0;
        command = '';
        user = '';
        protocol = '';
        name = '';
        state = '';
        break;
      case 'c':
        command = value;
        break;
      case 'u':
        user = value;
        break;
      case 'f':
        flushFile();
        protocol = '';
        name = '';
        state = '';
        break;
      case 'P':
        protocol = value;
        break;
      case 'n':
        name = value;
        break;
      case 'T':
        if (value.startsWith('ST=')) {
          state = value.slice(3);
        }
        break;
      default:
        break;
    }
  }
  flushFile();
  return results;
}

export function parseSsLine(line: string): OccupiedPort | undefined {
  const trimmed = line.trim();
  if (!trimmed || /^(Netid|State)\b/i.test(trimmed)) {
    return undefined;
  }

  const usersIndex = trimmed.search(/\susers:/);
  const main = (usersIndex >= 0 ? trimmed.slice(0, usersIndex) : trimmed).trim();
  const processPart = usersIndex >= 0 ? trimmed.slice(usersIndex + 1) : '';
  const parts = main.split(/\s+/);
  if (parts.length < 6) {
    return undefined;
  }

  const netid = parts[0].toLowerCase();
  if (!netid.startsWith('tcp') && !netid.startsWith('udp')) {
    return undefined;
  }

  const transport: Transport = netid.startsWith('udp') ? 'udp' : 'tcp';
  const state = parts[1];
  const local = splitHostPort(parts[4]);
  if (!local) {
    return undefined;
  }
  const remote = splitHostPort(parts[5]);

  let pid = 0;
  let processName = 'unknown';
  const procMatch = processPart.match(/users:\(\("([^"]+)",pid=(\d+)/);
  if (procMatch) {
    processName = procMatch[1];
    pid = Number.parseInt(procMatch[2], 10) || 0;
  }

  const entry: OccupiedPort = {
    id: '',
    transport,
    ipVersion: detectIpVersion(local.host),
    localAddress: local.host === '*' ? '0.0.0.0' : local.host,
    port: local.port,
    remoteAddress: remote?.host,
    remotePort: remote?.port,
    state: normalizeState(state, transport),
    pid,
    processName,
  };
  entry.id = makePortId(entry);
  return entry;
}

export function parseSs(text: string): OccupiedPort[] {
  return text
    .split(/\r?\n/)
    .map(parseSsLine)
    .filter((item): item is OccupiedPort => item !== undefined);
}

export function parseNetstatWindows(text: string): OccupiedPort[] {
  const results: OccupiedPort[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const tcpMatch = trimmed.match(/^TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/i);
    const udpMatch = !tcpMatch ? trimmed.match(/^UDP\s+(\S+)\s+(\S+)\s+(\d+)\s*$/i) : null;
    if (!tcpMatch && !udpMatch) {
      continue;
    }
    const transport: Transport = tcpMatch ? 'tcp' : 'udp';
    const localRaw = tcpMatch ? tcpMatch[1] : udpMatch![1];
    const remoteRaw = tcpMatch ? tcpMatch[2] : udpMatch![2];
    const state = tcpMatch ? tcpMatch[3] : 'LISTEN';
    const pidRaw = tcpMatch ? tcpMatch[4] : udpMatch![3];
    const local = splitHostPort(localRaw);
    if (!local) {
      continue;
    }
    const remote = remoteRaw === '*:*' ? undefined : splitHostPort(remoteRaw);
    const pid = Number.parseInt(pidRaw, 10) || 0;
    const entry: OccupiedPort = {
      id: '',
      transport,
      ipVersion: detectIpVersion(local.host),
      localAddress: local.host,
      port: local.port,
      remoteAddress: remote?.host,
      remotePort: remote?.port,
      state: normalizeState(state, transport),
      pid,
      processName: 'unknown',
    };
    entry.id = makePortId(entry);
    results.push(entry);
  }
  return results;
}

export function processNameFromArgs(args: string): string {
  const trimmed = args.trim();
  if (!trimmed) {
    return 'unknown';
  }
  const first = trimmed.startsWith('"')
    ? (trimmed.match(/^"([^"]+)"/)?.[1] ?? trimmed.split(/\s+/)[0])
    : trimmed.split(/\s+/)[0];
  const base = first.split(/[/\\]/).pop() ?? first;
  return base.replace(/\.$/, '') || 'unknown';
}
