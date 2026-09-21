#!/usr/bin/env bash
# Installs the demo-record + demo-video skills into a project (or globally).
#
#   ./install.sh <project-dir>            symlink skills into <project>/.claude/skills/
#   ./install.sh <project-dir> --copy     copy instead (teammates without the kit can use them)
#   ./install.sh --global                 symlink into ~/.claude/skills/ (every project)
#
# Also creates <project>/demo.config.json from the example (if missing) and prints the
# .gitignore lines for generated files.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE=link
TARGET=""
for arg in "$@"; do
    case "$arg" in
        --copy) MODE=copy ;;
        --global) TARGET="$HOME" ;;
        -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
        *) TARGET="$(cd "$arg" && pwd)" ;;
    esac
done
if [[ -z "$TARGET" ]]; then
    sed -n '2,9p' "$0"; exit 2
fi

if [[ ! -d "$KIT/node_modules/@playwright/test" ]]; then
    echo "Installing kit dependencies (Playwright)…"
    (cd "$KIT" && npm install --silent && npx playwright install chromium)
fi

SKILLS="$TARGET/.claude/skills"
mkdir -p "$SKILLS"
for skill in demo-record demo-video; do
    dest="$SKILLS/$skill"
    if [[ -e "$dest" || -L "$dest" ]]; then
        echo "  $dest exists — replacing"
        rm -rf "$dest"
    fi
    if [[ "$MODE" == copy ]]; then
        cp -R "$KIT/skills/$skill" "$dest"
    else
        ln -s "$KIT/skills/$skill" "$dest"
    fi
    echo "  $MODE: $dest"
done

if [[ "$TARGET" != "$HOME" ]]; then
    if [[ ! -f "$TARGET/demo.config.json" ]]; then
        cp "$KIT/demo.config.example.json" "$TARGET/demo.config.json"
        echo "  created $TARGET/demo.config.json — set brand, language and music"
    fi
    cat <<GITIGNORE

Add to $TARGET/.gitignore (adjust docs/videos to your videosDir):

    /docs/videos/**/recording.*
    /docs/videos/**/.raw/
    /docs/videos/**/video/assets/
    /docs/videos/**/video/renders/
    /docs/videos/**/video/snapshots/
    /docs/videos/**/video/node_modules/
    /docs/videos/**/*.openscreen
GITIGNORE
    if [[ "$MODE" == copy ]]; then
        echo
        echo "Copied skills resolve @playwright/test from the project: it needs @playwright/test installed."
    fi
fi
