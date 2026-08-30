#!/usr/bin/env bash
#
# Server Control Panel installer.
#
 sudo bash| sudo bash
#
# Re-running upgrades an existing install in place, keeping data and secrets.
#
set -Eeuo pipefail

REPO_URL="${SCP_REPO_URL:-https://github.com/lourxd/server.git}"
BRANCH="${SCP_BRANCH:-main}"
INSTALL_DIR="${SCP_INSTALL_DIR:-/opt/server-control-panel}"
SERVICE_NAME="${SCP_SERVICE_NAME:-control-panel}"
PORT="${SCP_PORT:-8088}"
HOST_BIND="${SCP_HOST:-0.0.0.0}"
NODE_MAJOR_MIN=22

RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BLUE=$'\e[34m'; BOLD=$'\e[1m'; DIM=$'\e[2m'; RESET=$'\e[0m'
step()  { printf '%s==>%s %s\n' "$BLUE$BOLD" "$RESET$BOLD" "$*$RESET"; }
info()  { printf '    %s\n' "$*"; }
warn()  { printf '%s !  %s%s\n' "$YELLOW" "$*" "$RESET"; }
ok()    { printf '%s ✓  %s%s\n' "$GREEN" "$*" "$RESET"; }
die()   { printf '%s ✗  %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

trap 'die "Install failed on line $LINENO. Nothing was started; re-run once the cause is fixed."' ERR

# ---------------------------------------------------------------- preflight --

[[ $EUID -eq 0 ]] || die "Run as root:  curl -fsSL <url> | sudo bash"

# The panel manages one user's PM2 apps, so it must run as that user — not root,
# and not a service account whose PM2_HOME nobody else uses.
TARGET_USER="${SCP_USER:-${SUDO_USER:-}}"
[[ -n "$TARGET_USER" && "$TARGET_USER" != "root" ]] || die \
  "Set the user that will own the apps:  SCP_USER=youruser curl -fsSL <url> | sudo -E bash"
id "$TARGET_USER" &>/dev/null || die "User '$TARGET_USER' does not exist."

TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
TARGET_GROUP=$(id -gn "$TARGET_USER")
[[ -d "$TARGET_HOME" ]] || die "Home directory for '$TARGET_USER' not found."

step "Server Control Panel installer"
info "user         : $TARGET_USER ($TARGET_GROUP)"
info "install dir  : $INSTALL_DIR"
info "port         : $PORT"

command -v systemctl &>/dev/null || die "systemd is required."

# ------------------------------------------------------------- dependencies --

install_packages() {
  local missing=()
  for pkg in "$@"; do command -v "$pkg" &>/dev/null || missing+=("$pkg"); done
  [[ ${#missing[@]} -eq 0 ]] && return 0

  step "Installing: ${missing[*]}"
  if command -v apt-get &>/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}" >/dev/null
  elif command -v dnf &>/dev/null; then dnf install -y -q "${missing[@]}" >/dev/null
  elif command -v pacman &>/dev/null; then pacman -Sy --noconfirm --quiet "${missing[@]}" >/dev/null
  else die "No supported package manager (apt/dnf/pacman). Install manually: ${missing[*]}"
  fi
  ok "Installed ${missing[*]}"
}

install_packages curl git

# Node: prefer whatever the target user already has (nvm counts), else install.
find_node() {
  local candidate
  candidate=$(sudo -u "$TARGET_USER" -i bash -lc 'command -v node 2>/dev/null' 2>/dev/null || true)
  [[ -n "$candidate" && -x "$candidate" ]] && { echo "$candidate"; return; }
  command -v node 2>/dev/null || true
}

NODE_BIN=$(find_node)
NODE_OK=false
if [[ -n "$NODE_BIN" ]]; then
  NODE_MAJOR=$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [[ "$NODE_MAJOR" -ge "$NODE_MAJOR_MIN" ]] && NODE_OK=true
fi

if [[ "$NODE_OK" != true ]]; then
  step "Installing Node.js $NODE_MAJOR_MIN+"
  if command -v apt-get &>/dev/null; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_MIN}.x" | bash - >/dev/null 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
  elif command -v dnf &>/dev/null; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR_MIN}.x" | bash - >/dev/null 2>&1
    dnf install -y -q nodejs >/dev/null
  else
    die "Install Node.js ${NODE_MAJOR_MIN}+ manually, then re-run."
  fi
  NODE_BIN=$(command -v node)
fi
ok "Node $("$NODE_BIN" -v) at $NODE_BIN"

NPM_BIN="$(dirname "$NODE_BIN")/npm"
[[ -x "$NPM_BIN" ]] || NPM_BIN=$(command -v npm) || die "npm not found next to node."

# PM2 is what the panel drives; install it for the target user if absent.
if ! sudo -u "$TARGET_USER" -i bash -lc 'command -v pm2' &>/dev/null; then
  step "Installing PM2"
  "$NPM_BIN" install -g pm2 >/dev/null 2>&1 || die "Could not install PM2 globally."
  ok "PM2 installed"
fi

# --------------------------------------------------------------- fetch code --

UPGRADE=false
[[ -d "$INSTALL_DIR/.git" ]] && UPGRADE=true

if [[ "$UPGRADE" == true ]]; then
  step "Upgrading existing install"
  sudo -u "$TARGET_USER" git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH" --quiet
  sudo -u "$TARGET_USER" git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH" --quiet
else
  step "Fetching source"
  if [[ -d "$INSTALL_DIR" && -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
    die "$INSTALL_DIR exists and is not a git checkout. Move it aside or set SCP_INSTALL_DIR."
  fi
  mkdir -p "$INSTALL_DIR"
  chown "$TARGET_USER:$TARGET_GROUP" "$INSTALL_DIR"
  sudo -u "$TARGET_USER" git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" --quiet
fi
ok "Source at $INSTALL_DIR"

# ------------------------------------------------------------------- build ---

step "Installing dependencies"
sudo -u "$TARGET_USER" env PATH="$(dirname "$NODE_BIN"):$PATH" \
  "$NPM_BIN" --prefix "$INSTALL_DIR" ci --no-audit --no-fund >/dev/null
ok "Dependencies installed"

step "Building"
sudo -u "$TARGET_USER" env PATH="$(dirname "$NODE_BIN"):$PATH" \
  "$NPM_BIN" --prefix "$INSTALL_DIR" run build >/dev/null
[[ -f "$INSTALL_DIR/build/index.js" ]] || die "Build produced no output."
ok "Built"

# ------------------------------------------------------------ configuration --

ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  step "Writing configuration"
  # Generated once and preserved on upgrade: rotating these would invalidate
  # every session and make stored credentials undecryptable.
  cat > "$ENV_FILE" <<EOF
HOST=$HOST_BIND
PORT=$PORT
PM2D_PROJECTS_DIR=$TARGET_HOME/projects
PM2_HOME=$TARGET_HOME/.pm2
PM2D_SECURE_COOKIES=false
BETTER_AUTH_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_')
PM2D_SECRET_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
EOF
  ok "Wrote $ENV_FILE"
else
  info "Keeping existing $ENV_FILE"
fi

chown "$TARGET_USER:$TARGET_GROUP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

sudo -u "$TARGET_USER" mkdir -p "$TARGET_HOME/projects" "$INSTALL_DIR/data"
chmod 700 "$INSTALL_DIR/data"
chown -R "$TARGET_USER:$TARGET_GROUP" "$INSTALL_DIR"

# ----------------------------------------------------------------- service ---

step "Installing systemd units"

PM2_BIN="$INSTALL_DIR/node_modules/.bin/pm2"
PM2_UNIT="/etc/systemd/system/pm2.service"
sed -e "s|__USER__|$TARGET_USER|g" \
    -e "s|__GROUP__|$TARGET_GROUP|g" \
    -e "s|__PM2_HOME__|$TARGET_HOME/.pm2|g" \
    -e "s|__NODE_BIN_DIR__|$(dirname "$NODE_BIN")|g" \
    -e "s|__PM2__|$PM2_BIN|g" \
    "$INSTALL_DIR/deploy/pm2.service" > "$PM2_UNIT"

UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
sed -e "s|__USER__|$TARGET_USER|g" \
    -e "s|__GROUP__|$TARGET_GROUP|g" \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    -e "s|__NODE__|$NODE_BIN|g" \
    "$INSTALL_DIR/deploy/control-panel.service" > "$UNIT"

systemctl daemon-reload
# The daemon must exist before the panel connects, or the panel spawns one into
# its own cgroup and loses every app on the next restart.
systemctl enable pm2 >/dev/null 2>&1
systemctl start pm2 || warn "pm2.service did not start; apps will not resurrect on boot."
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
systemctl restart "$SERVICE_NAME"
ok "Services pm2 and ${SERVICE_NAME} enabled and started"

# ------------------------------------------------------------------- verify --

step "Waiting for the panel to answer"
READY=false
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then READY=true; break; fi
  sleep 1
done

if [[ "$READY" != true ]]; then
  warn "The service did not become healthy in 30s. Recent log:"
  journalctl -u "$SERVICE_NAME" -n 25 --no-pager || true
  die "Install completed but the panel is not responding."
fi

STATUS=$(curl -fsS "http://127.0.0.1:$PORT/api/health" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
ok "Panel is healthy (status: $STATUS)"

printf '\n%s%s  Server Control Panel is running%s\n\n' "$BOLD" "$GREEN" "$RESET"
printf '    %sOpen%s   http://%s:%s\n' "$BOLD" "$RESET" "${IP:-localhost}" "$PORT"
[[ "$STATUS" == "setup-required" ]] && \
  printf '    %sNext%s   create the owner account on first visit\n' "$BOLD" "$RESET"
printf '\n    %slogs%s     journalctl -u %s -f\n' "$DIM" "$RESET" "$SERVICE_NAME"
printf '    %srestart%s  systemctl restart %s\n' "$DIM" "$RESET" "$SERVICE_NAME"
printf '    %supgrade%s  re-run this installer\n' "$DIM" "$RESET"
printf '    %sremove%s   %s/uninstall.sh\n\n' "$DIM" "$RESET" "$INSTALL_DIR"

if [[ "$HOST_BIND" == "0.0.0.0" ]]; then
  warn "The panel is reachable from your whole network and can control this machine."
  warn "Put it behind TLS and set PM2D_SECURE_COOKIES=true before exposing it further."
fi
