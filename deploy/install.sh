#!/bin/bash
# SpawnBot — Installation Script
# Usage: sudo ./deploy/install.sh [install_dir] [user]

set -e

INSTALL_DIR="${1:-/opt/spawnbot}"
USER="${2:-$SUDO_USER}"

if [ -z "$USER" ]; then
  echo "Error: Run with sudo or specify user as second argument"
  exit 1
fi

echo "Installing SpawnBot to $INSTALL_DIR for user $USER"

# Create install directory
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"
chown -R "$USER:$USER" "$INSTALL_DIR"

# Create data directories
mkdir -p "$INSTALL_DIR/data/logs"
chown -R "$USER:$USER" "$INSTALL_DIR/data"

# Install Node.js dependencies
cd "$INSTALL_DIR"
sudo -u "$USER" npm install --production

# Create .env if it doesn't exist
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" << 'ENVEOF'
# SpawnBot Configuration
# Fill in your credentials:

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Optional: X/Twitter (enable in config/integrations.yaml)
# TWITTER_BEARER_TOKEN=
# TWITTER_API_KEY=
# TWITTER_API_SECRET=
# TWITTER_ACCESS_TOKEN=
# TWITTER_ACCESS_SECRET=
# TWITTER_USER_ID=

# LLM Provider (configured in Kimi CLI)
# See: kimi /login

# LLM and agent settings are configured via spawnbot setup
ENVEOF
  chown "$USER:$USER" "$INSTALL_DIR/.env"
  echo "Created .env — edit $INSTALL_DIR/.env with your credentials"
fi

# Install systemd service
SERVICE_FILE="/etc/systemd/system/spawnbot.service"
sed "s|/opt/spawnbot|$INSTALL_DIR|g" "$INSTALL_DIR/deploy/spawnbot.service" > "$SERVICE_FILE"
sed -i "s|%i|$USER|g" "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable spawnbot

echo ""
echo "SpawnBot installed successfully."
echo ""
echo "Next steps:"
echo "  1. Edit $INSTALL_DIR/.env with your credentials"
echo "  2. Configure Kimi CLI: kimi /login"
echo "  3. Start: sudo systemctl start spawnbot"
echo "  4. Check status: sudo systemctl status spawnbot"
echo "  5. View logs: tail -f $INSTALL_DIR/data/logs/spawnbot.log"
