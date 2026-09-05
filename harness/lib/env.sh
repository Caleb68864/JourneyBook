# shellcheck shell=bash
# harness/lib/env.sh -- shared environment resolution for the harness.
#
# Source this from init.sh and the checks:
#   . "$(dirname "${BASH_SOURCE[0]}")/../lib/env.sh"
#
# Every helper is safe under `set -euo pipefail`: they return non-zero rather
# than exiting, so a caller decides whether a missing prerequisite is fatal.
# Each failure prints the exact remediation command for this machine.

# Where a user-local pnpm goes when neither corepack nor a global install works.
JB_PNPM_PREFIX="${JB_PNPM_PREFIX:-$HOME/.npm-global}"
# Kept in step with the root package.json "packageManager" field.
JB_PNPM_VERSION="${JB_PNPM_VERSION:-10}"

jb_say() { printf '%s\n' "$*"; }
jb_warn() { printf '%s\n' "$*" >&2; }

# --- pnpm ------------------------------------------------------------------

# Add a user-local npm prefix's bin dir to PATH (idempotent).
jb_add_local_bin() {
  local bin="$JB_PNPM_PREFIX/node_modules/.bin"
  if [ -d "$bin" ]; then
    case ":$PATH:" in
      *":$bin:"*) ;;
      *) PATH="$bin:$PATH"; export PATH ;;
    esac
  fi
  return 0
}

# Resolve pnpm, installing it locally if needed. Exports an updated PATH so
# every later command in the same shell finds it. Returns 1 if unavailable.
#
# Order: already on PATH -> a previous user-local install -> corepack ->
# `npm install --prefix ~/.npm-global`. The last step is what works on a box
# where `npm install -g` is denied (no write access to /usr).
jb_ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then return 0; fi

  jb_add_local_bin
  if command -v pnpm >/dev/null 2>&1; then
    jb_say "    pnpm resolved from $JB_PNPM_PREFIX (added to PATH)"
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    jb_warn "    node is not installed - install Node >= 22, then re-run."
    return 1
  fi

  if command -v corepack >/dev/null 2>&1; then
    if corepack enable >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1; then
      jb_say "    pnpm enabled via corepack"
      return 0
    fi
  fi

  jb_say "    pnpm not found - installing pnpm@$JB_PNPM_VERSION into $JB_PNPM_PREFIX ..."
  if ! npm install --prefix "$JB_PNPM_PREFIX" "pnpm@$JB_PNPM_VERSION" >/dev/null 2>&1; then
    jb_warn "    Could not install pnpm. Install it yourself, then re-run:"
    jb_warn "      npm install --prefix \"$JB_PNPM_PREFIX\" pnpm@$JB_PNPM_VERSION"
    jb_warn "      export PATH=\"$JB_PNPM_PREFIX/node_modules/.bin:\$PATH\""
    return 1
  fi

  jb_add_local_bin
  if command -v pnpm >/dev/null 2>&1; then
    jb_say "    pnpm installed. Add this to your shell profile to keep it on PATH:"
    jb_say "      export PATH=\"$JB_PNPM_PREFIX/node_modules/.bin:\$PATH\""
    return 0
  fi

  jb_warn "    pnpm still not on PATH after install."
  return 1
}

# --- .NET ------------------------------------------------------------------

# The API targets ASP.NET Core, which ships as its own shared framework. An SDK
# without it fails with NETSDK1226 ("Prune Package data not found ...
# Microsoft.AspNetCore.App"), which reads like a project bug but is a missing
# system package. Returns 1 (with remediation) when it is absent.
jb_check_dotnet() {
  if ! command -v dotnet >/dev/null 2>&1; then
    jb_warn "    dotnet is not installed - install the .NET 10 SDK."
    return 1
  fi

  if dotnet --list-runtimes 2>/dev/null | grep -q '^Microsoft.AspNetCore.App '; then
    return 0
  fi

  jb_warn "    The ASP.NET Core runtime (Microsoft.AspNetCore.App) is missing;"
  jb_warn "    the .NET SDK alone cannot build apps/api (error NETSDK1226)."
  if command -v pacman >/dev/null 2>&1; then
    jb_warn "      sudo pacman -S aspnet-runtime"
  elif command -v apt-get >/dev/null 2>&1; then
    jb_warn "      sudo apt-get install -y aspnetcore-runtime-10.0"
  elif command -v dnf >/dev/null 2>&1; then
    jb_warn "      sudo dnf install -y aspnetcore-runtime-10.0"
  else
    jb_warn "      Install the ASP.NET Core 10 runtime for your distribution."
  fi
  return 1
}

# --- Docker ----------------------------------------------------------------

# Backend integration tests run against real PostGIS via Testcontainers, so the
# daemon must be reachable. Distinguishes "not installed" from "not running"
# from the Arch/EndeavourOS trap where a kernel upgrade removed the running
# kernel's modules, so dockerd cannot load xt_addrtype until a reboot.
jb_check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    jb_warn "    docker is not installed - backend integration tests cannot run."
    return 1
  fi

  if docker info >/dev/null 2>&1; then return 0; fi

  jb_warn "    The Docker daemon is not reachable."
  if [ ! -d "/usr/lib/modules/$(uname -r)" ] && [ ! -d "/lib/modules/$(uname -r)" ]; then
    jb_warn "      The running kernel ($(uname -r)) has no module tree installed,"
    jb_warn "      so dockerd cannot load its netfilter modules (xt_addrtype)."
    jb_warn "      A kernel upgrade landed since boot - REBOOT, then re-run."
  else
    jb_warn "      Start it with: sudo systemctl start docker"
    jb_warn "      (then check: systemctl status docker)"
  fi
  return 1
}
