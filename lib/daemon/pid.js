import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';

export function readPidFile(projectRoot) {
  const pidPath = resolve(projectRoot, 'data/spawnbot.pid');
  if (!existsSync(pidPath)) return null;
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function writePidFile(projectRoot, pid) {
  const pidPath = resolve(projectRoot, 'data/spawnbot.pid');
  writeFileSync(pidPath, String(pid));
}

export function removePidFile(projectRoot) {
  const pidPath = resolve(projectRoot, 'data/spawnbot.pid');
  if (existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
}

export function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}
