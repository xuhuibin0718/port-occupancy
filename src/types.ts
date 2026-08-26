export type Transport = 'tcp' | 'udp';

export interface OccupiedPort {
  id: string;
  transport: Transport;
  ipVersion: 4 | 6;
  localAddress: string;
  port: number;
  remoteAddress?: string;
  remotePort?: number;
  state: string;
  pid: number;
  processName: string;
  commandLine?: string;
  user?: string;
}

export type GroupBy = 'process' | 'port';

export interface ScanOptions {
  showUdp: boolean;
  showEstablished: boolean;
  ignoredProcesses: string[];
  ignoredPorts: number[];
}

export interface ScanResult {
  ports: OccupiedPort[];
  warning?: string;
}

export function makePortId(port: Omit<OccupiedPort, 'id' | 'processName' | 'commandLine'>): string {
  return [
    port.transport,
    port.localAddress,
    port.port,
    port.remoteAddress ?? '',
    port.remotePort ?? '',
    port.pid,
    port.state,
  ].join('|');
}
