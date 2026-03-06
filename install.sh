#!/usr/bin/env bash
#
# spawnbot installer — installs the framework to ~/.spawnbot
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dawnforge-lab/spawnbot/main/install.sh | bash
#
# After install, setup runs automatically.
#

set -euo pipefail

SPAWNBOT_HOME="${SPAWNBOT_HOME:-$HOME/.spawnbot}"
REPO_URL="https://github.com/dawnforge-lab/spawnbot.git"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${DIM}$1${NC}"; }

echo ""
echo -e "${CYAN}${BOLD}╭───────────────────────────────╮${NC}"
echo -e "${CYAN}${BOLD}│  spawnbot installer             │${NC}"
echo -e "${CYAN}${BOLD}╰───────────────────────────────╯${NC}"
echo ""

# ── Check prerequisites ─────────────────────────────

if ! command -v node &> /dev/null; then
  fail "Node.js not found"
  info "Install Node.js 20+: https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.version.slice(1).split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js $(node --version) too old (need >= 20)"
  exit 1
fi
ok "Node.js $(node --version)"

if ! command -v npm &> /dev/null; then
  fail "npm not found"
  exit 1
fi
ok "npm $(npm --version)"

if ! command -v git &> /dev/null; then
  fail "git not found"
  exit 1
fi
ok "git $(git --version | awk '{print $3}')"

if command -v kimi &> /dev/null; then
  KIMI_VER=$(kimi --version 2>&1 | grep -oP '\d+\.\d+\.\d+' | head -1)
  ok "Kimi CLI v${KIMI_VER:-installed}"
else
  fail "Kimi CLI not found"
  echo ""
  info "Install Kimi CLI:"
  info "  pip install kimi-cli"
  info "  # or: uv tool install kimi-cli"
  echo ""
  read -p "  Continue without Kimi CLI? (y/N) " -n 1 -r < /dev/tty
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# ── Install / update spawnbot ────────────────────────

echo ""
if [ -d "$SPAWNBOT_HOME/.git" ]; then
  echo -e "${BOLD}Updating spawnbot...${NC}"
  git -C "$SPAWNBOT_HOME" pull --quiet
  ok "Updated from git"
else
  echo -e "${BOLD}Installing spawnbot to ${SPAWNBOT_HOME}...${NC}"
  git clone --quiet "$REPO_URL" "$SPAWNBOT_HOME"
  ok "Cloned to $SPAWNBOT_HOME"
fi

# ── Install dependencies ────────────────────────────

echo -e "${BOLD}Installing dependencies...${NC}"
cd "$SPAWNBOT_HOME"
npm install --loglevel=warn 2>&1 | tail -3
ok "Dependencies installed"

# ── Link CLI command ─────────────────────────────────

# Try npm link first, fall back to manual symlink
if npm link --loglevel=warn 2>/dev/null; then
  ok "spawnbot command linked (npm link)"
else
  # npm link may fail without sudo — create manual symlink
  LOCAL_BIN="$HOME/.local/bin"
  mkdir -p "$LOCAL_BIN"
  ln -sf "$SPAWNBOT_HOME/bin/spawnbot.js" "$LOCAL_BIN/spawnbot"
  chmod +x "$SPAWNBOT_HOME/bin/spawnbot.js"
  ok "spawnbot command linked to $LOCAL_BIN/spawnbot"

  # Check if ~/.local/bin is in PATH
  if ! echo "$PATH" | grep -q "$LOCAL_BIN"; then
    echo ""
    info "Add to your shell profile (~/.bashrc or ~/.zshrc):"
    info "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
fi

# ── Run setup ─────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}  Installation complete!${NC}"
echo ""

# Auto-run setup in the default agent directory
AGENT_DIR="$SPAWNBOT_HOME/agent"
mkdir -p "$AGENT_DIR"
cd "$AGENT_DIR"
echo -e "${BOLD}Starting setup...${NC}"
echo ""
node "$SPAWNBOT_HOME/bin/spawnbot.js" setup < /dev/tty
