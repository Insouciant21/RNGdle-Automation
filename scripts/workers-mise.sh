#!/bin/sh
set -eu

# Workers Builds does not preinstall mise. Keep the CI version separate from
# any system installation; Node.js and pnpm versions come from the repository.
mise_bin="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}/bootstrap/mise-2026.10.22"
if [ ! -x "$mise_bin" ]; then
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  curl --fail --silent --show-error --location --retry 2 https://mise.run -o "$installer"
  MISE_VERSION=2026.10.22 MISE_INSTALL_PATH="$mise_bin" MISE_INSTALL_HELP=0 sh "$installer"
  rm -f "$installer"
  trap - EXIT
fi

"$mise_bin" trust mise.toml
if [ "$#" -eq 0 ]; then
  set -- build:workers
fi
exec "$mise_bin" --yes run "$@"
