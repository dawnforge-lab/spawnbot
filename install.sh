#!/usr/bin/env bash
#
# spawnbot installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dawnforge-lab/spawnbot/main/install.sh | bash
#
# What it does:
#   1. Installs bun (if not already installed)
#   2. Clones spawnbot to ~/.spawnbot
#   3. Runs bun install
#   4. Adds spawnbot to your PATH
#   5. Launches the setup wizard
#

set -euo pipefail

INSTALL_DIR="$HOME/.spawnbot"
REPO_URL="https://github.com/dawnforge-lab/spawnbot.git"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info() { echo -e "${CYAN}$*${RESET}"; }
success() { echo -e "${GREEN}$*${RESET}"; }
warn() { echo -e "${YELLOW}$*${RESET}"; }
error() { echo -e "${RED}$*${RESET}" >&2; }

echo ""
echo -e "${BOLD}  spawnbot installer${RESET}"
echo ""

# --- Step 1: Check for bun ---
# Bun may be installed but not in PATH (e.g. fresh install, bashrc not sourced)
if ! command -v bun &>/dev/null && [[ -f "$HOME/.bun/bin/bun" ]]; then
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if command -v bun &>/dev/null; then
  info "bun is already installed ($(bun --version))"
else
  error "bun is required but not installed."
  echo ""
  echo "  Install bun first, then re-run this installer:"
  echo ""
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo "    source ~/.bashrc"
  echo "    curl -fsSL https://raw.githubusercontent.com/dawnforge-lab/spawnbot/main/install.sh | bash"
  echo ""
  exit 1
fi

# --- Step 2: Check/install git ---
if ! command -v git &>/dev/null; then
  error "git is required but not installed."
  echo "Install git first:"
  echo "  Ubuntu/Debian: sudo apt install git"
  echo "  macOS: xcode-select --install"
  exit 1
fi

# --- Step 3: Clone or update spawnbot ---
if [[ -d "$INSTALL_DIR" ]]; then
  warn "spawnbot is already installed at $INSTALL_DIR"
  read -p "Update to latest version? [Y/n] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Nn]$ ]]; then
    info "Skipping update."
  else
    info "Updating spawnbot..."
    cd "$INSTALL_DIR"
    git pull --ff-only origin main || {
      warn "Could not fast-forward. You may have local changes."
      warn "Run 'cd $INSTALL_DIR && git pull' manually."
    }
  fi
else
  info "Cloning spawnbot to $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# --- Step 4: Install dependencies ---
info "Installing dependencies (this may take a minute)..."
cd "$INSTALL_DIR"

MAX_ATTEMPTS=3
for attempt in $(seq 1 $MAX_ATTEMPTS); do
  if timeout 120 bun install --frozen-lockfile 2>/dev/null || timeout 120 bun install; then
    break
  fi

  if [[ $attempt -lt $MAX_ATTEMPTS ]]; then
    warn "bun install attempt $attempt/$MAX_ATTEMPTS failed or timed out. Retrying..."
    rm -rf node_modules
  else
    error "bun install failed after $MAX_ATTEMPTS attempts."
    echo ""
    echo "  Try manually:"
    echo "    cd $INSTALL_DIR && bun install"
    echo ""
    exit 1
  fi
done

# --- Step 5: Add to PATH ---
BIN_DIR="$INSTALL_DIR/bin"
SHELL_NAME=$(basename "${SHELL:-/bin/bash}")
ADDED_TO_PATH=false

add_to_path() {
  local rc_file="$1"
  local path_line="export PATH=\"$BIN_DIR:\$PATH\""

  if [[ -f "$rc_file" ]] && grep -qF "$BIN_DIR" "$rc_file" 2>/dev/null; then
    return 0  # Already in PATH
  fi

  echo "" >> "$rc_file"
  echo "# spawnbot" >> "$rc_file"
  echo "$path_line" >> "$rc_file"
  ADDED_TO_PATH=true
}

case "$SHELL_NAME" in
  zsh)
    add_to_path "$HOME/.zshrc"
    ;;
  bash)
    # Prefer .bashrc, fall back to .bash_profile
    if [[ -f "$HOME/.bashrc" ]]; then
      add_to_path "$HOME/.bashrc"
    else
      add_to_path "$HOME/.bash_profile"
    fi
    ;;
  fish)
    # Fish uses a different syntax
    FISH_CONFIG="$HOME/.config/fish/config.fish"
    if [[ -f "$FISH_CONFIG" ]] && grep -qF "$BIN_DIR" "$FISH_CONFIG" 2>/dev/null; then
      :
    else
      mkdir -p "$(dirname "$FISH_CONFIG")"
      echo "" >> "$FISH_CONFIG"
      echo "# spawnbot" >> "$FISH_CONFIG"
      echo "set -gx PATH $BIN_DIR \$PATH" >> "$FISH_CONFIG"
      ADDED_TO_PATH=true
    fi
    ;;
  *)
    warn "Unknown shell: $SHELL_NAME"
    warn "Add this to your shell config manually:"
    warn "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

# Make spawnbot available in current session
export PATH="$BIN_DIR:$PATH"

# --- Step 6: Create default SOUL.md ---
SPAWNBOT_CONFIG="$HOME/.spawnbot"
SOUL_FILE="$SPAWNBOT_CONFIG/SOUL.md"

if [[ ! -f "$SOUL_FILE" ]]; then
  mkdir -p "$SPAWNBOT_CONFIG"
  cp "$INSTALL_DIR/src/soul/default-soul.txt" "$SOUL_FILE"
fi

echo ""
success "spawnbot installed successfully!"
echo ""

if [[ "$ADDED_TO_PATH" == "true" ]]; then
  info "PATH updated. Run this to use spawnbot now:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
  echo ""
fi

echo -e "${BOLD}Next steps:${RESET}"
echo ""
echo "  1. Review your agent's instructions:"
echo -e "     ${CYAN}$SOUL_FILE${RESET}"
echo "     Edit this file to customize how your agent works."
echo "     Everything above --- controls behavior, below --- is identity."
echo ""
echo "  2. Launch spawnbot:"
echo "     spawnbot"
echo ""
echo "  3. Type /setup to create your agent's identity"
echo "     (this adds to SOUL.md without overwriting your edits)"
echo ""

# If stdin is a terminal (not piped), offer to launch
if [ -t 0 ]; then
  info "Starting spawnbot..."
  echo ""
  exec "$BIN_DIR/spawnbot"
else
  # When piped (curl | bash), stdin is the script — can't run interactive prompts
  info "Since you installed via pipe, open a new terminal and run: spawnbot"
fi
