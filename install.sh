#!/usr/bin/env bash
# Installs reelson from this checkout: the `reelson` command (npm link, once per machine), then
# `reelson install` — the reelson-record + reelson-compose skills per project, or globally.
# (Without a checkout: `npm install -g reelson && reelson install <project-dir>`.)
#
#   ./install.sh                 ask where (default: every project)
#   ./install.sh --global        link the skills into ~/.agents + ~/.claude (every project)
#   ./install.sh <project-dir>   link the skills into <project>/.agents/skills/ + .claude/skills/, create
#                                <project>/reelson.config.json if it is missing
#
# Skills are symlinks to this checkout, so `git pull` here updates every project.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    sed -n '2,11p' "$0"; exit 0
fi

node_major="$(node -p 'process.versions.node.split(".").map(Number).slice(0,2).join(".")')"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)'; then
    echo "reelson needs Node 22.18+ (found $node_major)"; exit 1
fi

if [[ ! -d "$KIT/node_modules/@playwright/test" ]]; then
    echo "Installing kit dependencies…"
    (cd "$KIT" && npm install --silent)
fi
# reelson was called reelkit: drop the old command if it was an `npm link` of a kit checkout
# (a symlink, possibly dangling once the checkout was renamed; a published package is left alone).
if [[ -L "$(npm prefix -g)/lib/node_modules/reelkit" ]]; then
    echo "Removing the old reelkit command…"
    npm rm -g reelkit --silent
fi
if ! command -v reelson >/dev/null || [[ "$(realpath "$(command -v reelson)")" != "$KIT/bin/run.js" ]]; then
    echo "Linking the reelson command (npm link)…"
    (cd "$KIT" && npm link --silent)
fi

node "$KIT/bin/reelson.ts" install "$@"
