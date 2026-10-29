import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const cwd = process.cwd();
const baseURL = 'http://127.0.0.1:3100';
const nextBin = join(cwd, 'node_modules/next/dist/bin/next');
const playwrightBin = join(cwd, 'node_modules/@playwright/test/cli.js');

const server = spawn(
  process.execPath,
  [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', '3100'],
  {
    cwd,
    env: {
      ...process.env,
      AUTH_PASSCODE: 'e2e-passcode',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: 'inherit',
    windowsHide: true,
  },
);

let testProcess = null;
let stopping = false;

async function stopServer() {
  if (stopping || server.exitCode !== null) return;
  stopping = true;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (server.exitCode === null) {
    server.kill('SIGKILL');
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next 启动失败，退出码 ${server.exitCode}`);
    try {
      await fetch(`${baseURL}/login`, { redirect: 'manual' });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('等待 Next 启动超时');
}

try {
  await waitForServer();
  testProcess = spawn(process.execPath, [playwrightBin, 'test', ...process.argv.slice(2)], {
    cwd,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  const [code] = await once(testProcess, 'exit');
  process.exitCode = code ?? 1;
} finally {
  await stopServer();
}
