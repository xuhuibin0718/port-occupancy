import assert from 'node:assert/strict';
import {
  parseLsofFields,
  parseNetstatWindows,
  parseSs,
  processNameFromArgs,
  splitHostPort,
} from './parse';

function testSplitHostPort(): void {
  assert.deepEqual(splitHostPort('127.0.0.1:3000'), { host: '127.0.0.1', port: 3000 });
  assert.deepEqual(splitHostPort('[::1]:5173'), { host: '::1', port: 5173 });
  assert.deepEqual(splitHostPort('*:80'), { host: '*', port: 80 });
  assert.equal(splitHostPort('no-port'), undefined);
}

function testLsof(): void {
  const sample = [
    'p12345',
    'cnode',
    'u501',
    'f23',
    'PTCP',
    'n127.0.0.1:3000 (LISTEN)',
    'TST=LISTEN',
    'f24',
    'PTCP',
    'n*:5173 (LISTEN)',
    'p99',
    'cpostgres',
    'f5',
    'PTCP',
    'n[::1]:5432 (LISTEN)',
  ].join('\n');

  const ports = parseLsofFields(sample);
  assert.equal(ports.length, 3);
  assert.equal(ports[0]?.port, 3000);
  assert.equal(ports[0]?.processName, 'node');
  assert.equal(ports[0]?.state, 'LISTEN');
  assert.equal(ports[1]?.localAddress, '0.0.0.0');
  assert.equal(ports[2]?.ipVersion, 6);
  assert.equal(ports[2]?.port, 5432);
}

function testSs(): void {
  const sample = [
    'tcp   LISTEN 0  4096  0.0.0.0:22  0.0.0.0:*  users:(("sshd",pid=821,fd=3))',
    'tcp   LISTEN 0  511   *:3000      *:*        users:(("node",pid=4421,fd=19))',
    'udp   UNCONN 0  0     127.0.0.1:53 0.0.0.0:* users:(("dnsmasq",pid=12,fd=4))',
  ].join('\n');
  const ports = parseSs(sample);
  assert.equal(ports.length, 3);
  assert.equal(ports[0]?.pid, 821);
  assert.equal(ports[1]?.port, 3000);
  assert.equal(ports[2]?.transport, 'udp');
}

function testNetstat(): void {
  const sample = [
    'TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       968',
    'TCP    127.0.0.1:3000         127.0.0.1:51234        ESTABLISHED     4421',
    'UDP    0.0.0.0:5353           *:*                                    449',
  ].join('\n');
  const ports = parseNetstatWindows(sample);
  assert.equal(ports.length, 3);
  assert.equal(ports[0]?.state, 'LISTEN');
  assert.equal(ports[1]?.state, 'ESTABLISHED');
  assert.equal(ports[2]?.transport, 'udp');
  assert.equal(ports[2]?.pid, 449);
}

function testProcessName(): void {
  assert.equal(processNameFromArgs('/usr/local/bin/node server.js'), 'node');
  assert.equal(processNameFromArgs('"C:\\Program Files\\app.exe" --flag'), 'app.exe');
}

testSplitHostPort();
testLsof();
testSs();
testNetstat();
testProcessName();
console.log('parse.selftest ok');
