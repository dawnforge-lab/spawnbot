/**
 * Systemd service management — install/uninstall/status for the agent daemon.
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { userInfo } from 'os';

const SERVICE_NAME = 'spawnbot';
const UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;
const SUDOERS_FILE = `/etc/sudoers.d/spawnbot-${userInfo().username}`;

/**
 * Check if systemd is available on this machine.
 */
export function isSystemdAvailable() {
  try {
    execSync('systemctl --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate the systemd unit file content for the current environment.
 */
export function generateUnitFile(projectRoot) {
  const nodePath = process.execPath;
  const user = userInfo().username;
  const spawnbotJs = resolve(projectRoot, 'bin', 'spawnbot.js');
  const envFile = resolve(projectRoot, '.env');
  const logDir = resolve(projectRoot, 'data', 'logs');
  const logFile = resolve(logDir, 'spawnbot.log');

  return `[Unit]
Description=spawnbot agent daemon
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${projectRoot}
ExecStart=${nodePath} ${spawnbotJs} start --foreground
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5
${existsSync(envFile) ? `EnvironmentFile=${envFile}` : '# No .env file found'}
StandardOutput=append:${logFile}
StandardError=append:${logFile}

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Install and enable the systemd service. Requires sudo.
 */
export function installService(projectRoot) {
  // Ensure log directory exists
  const logDir = resolve(projectRoot, 'data', 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const unitContent = generateUnitFile(projectRoot);

  // Write to a temp file first, then sudo cp (can't sudo write directly)
  const tmpPath = resolve(projectRoot, 'data', `${SERVICE_NAME}.service`);
  writeFileSync(tmpPath, unitContent, 'utf8');

  try {
    execSync(`sudo cp "${tmpPath}" "${UNIT_PATH}"`, { stdio: 'inherit' });
    execSync('sudo systemctl daemon-reload', { stdio: 'inherit' });
    execSync(`sudo systemctl enable ${SERVICE_NAME}`, { stdio: 'inherit' });
    execSync(`sudo systemctl start ${SERVICE_NAME}`, { stdio: 'inherit' });
  } finally {
    // Clean up temp file
    try { unlinkSync(tmpPath); } catch {}
  }

  return true;
}

/**
 * Stop, disable, and remove the systemd service. Requires sudo.
 */
export function uninstallService() {
  try {
    execSync(`sudo systemctl stop ${SERVICE_NAME}`, { stdio: 'inherit' });
  } catch {
    // May not be running
  }
  try {
    execSync(`sudo systemctl disable ${SERVICE_NAME}`, { stdio: 'inherit' });
  } catch {
    // May not be enabled
  }
  try {
    execSync(`sudo rm -f "${UNIT_PATH}"`, { stdio: 'inherit' });
    execSync('sudo systemctl daemon-reload', { stdio: 'inherit' });
  } catch {
    // Best effort
  }
  return true;
}

/**
 * Check if the service is installed.
 */
export function isServiceInstalled() {
  return existsSync(UNIT_PATH);
}

/**
 * Get service status output.
 */
export function getServiceStatus() {
  try {
    const output = execSync(`systemctl status ${SERVICE_NAME} 2>&1`, { encoding: 'utf8' });
    return output;
  } catch (err) {
    // systemctl status returns non-zero for inactive services
    return err.stdout || err.message;
  }
}

/**
 * Check if passwordless sudo is configured for the current user.
 */
export function hasPasswordlessSudo() {
  if (!existsSync(SUDOERS_FILE)) return false;
  try {
    const content = readFileSync(SUDOERS_FILE, 'utf8');
    return content.includes('NOPASSWD');
  } catch {
    return false;
  }
}

/**
 * Set up passwordless sudo for the current user.
 * Requires sudo credentials to already be cached (run `sudo -v` first).
 */
export function setupPasswordlessSudo() {
  const user = userInfo().username;
  const rule = `${user} ALL=(ALL) NOPASSWD: ALL`;
  // Safe: user value comes from OS userInfo(), not from external input
  execSync(`echo '${rule}' | sudo tee ${SUDOERS_FILE} > /dev/null`, { stdio: 'pipe' });
  execSync(`sudo chmod 440 ${SUDOERS_FILE}`, { stdio: 'pipe' });
}
