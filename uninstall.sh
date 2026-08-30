#!/usr/bin/env bash
#
# Removes the Server Control Panel service. Data is kept unless --purge.
#
set -Eeuo pipefail

INSTALL_DIR="${SCP_INSTALL_DIR:-/opt/server-control-panel}"
SERVICE_NAME="${SCP_SERVICE_NAME:-control-panel}"
PURGE=false
[[ "${1:-}" == "--purge" ]] && PURGE=true

RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RESET=$'\e[0m'
ok()   { printf '%s ✓  %s%s\n' "$GREEN" "$*" "$RESET"; }
warn() { printf '%s !  %s%s\n' "$YELLOW" "$*" "$RESET"; }
die()  { printf '%s ✗  %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo $0 [--purge]"

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
  systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  ok "Service ${SERVICE_NAME} removed"
else
  warn "Service ${SERVICE_NAME} was not installed"
fi

# Apps the panel deployed are PM2's, not ours — leaving them running is the
# safe default, since removing the panel should not take a user's sites offline.
warn "Apps started through the panel are still running under PM2 (pm2 list)."

if [[ "$PURGE" == true ]]; then
  [[ -d "$INSTALL_DIR" ]] && { rm -rf "$INSTALL_DIR"; ok "Removed $INSTALL_DIR (including panel data)"; }
else
  [[ -d "$INSTALL_DIR" ]] && warn "Kept $INSTALL_DIR — pass --purge to delete it and its database."
fi

ok "Done"
