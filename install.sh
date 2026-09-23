#!/usr/bin/env bash
# Installs reelson: the `reelson` command (once per machine) and the
# reelson-record + reelson-compose skills (per project, or globally).
#
#   ./install.sh <project-dir>   link the skills into <project>/.claude/skills/ and create
#                                <project>/demo.config.json if it is missing
#   ./install.sh --global        link the skills into ~/.claude/skills/ (every project)
#
# Skills are symlinks to this checkout, so `git pull` here updates every project.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET=""
for arg in "$@"; do
    case "$arg" in
        --global) TARGET="$HOME" ;;
        -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
        *) TARGET="$(cd "$arg" && pwd)" ;;
    esac
done
if [[ -z "$TARGET" ]]; then
    sed -n '2,9p' "$0"; exit 2
fi

node_major="$(node -p 'process.versions.node.split(".").map(Number).slice(0,2).join(".")')"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)'; then
    echo "reelson needs Node 22.18+ (found $node_major)"; exit 1
fi
command -v ffmpeg >/dev/null || echo "warning: ffmpeg not found — brew install ffmpeg"

if [[ ! -d "$KIT/node_modules/@playwright/test" ]]; then
    echo "Installing kit dependencies (Playwright + Chromium)…"
    (cd "$KIT" && npm install --silent && npx playwright install chromium)
fi
# reelson was called reelkit: drop the old command if it was an `npm link` of a kit checkout
# (a symlink, possibly dangling once the checkout was renamed; a published package is left alone).
if [[ -L "$(npm prefix -g)/lib/node_modules/reelkit" ]]; then
    echo "Removing the old reelkit command…"
    npm rm -g reelkit --silent
fi
if ! command -v reelson >/dev/null || [[ "$(realpath "$(command -v reelson)")" != "$KIT/bin/reelson.ts" ]]; then
    echo "Linking the reelson command (npm link)…"
    (cd "$KIT" && npm link --silent)
fi

SKILLS="$TARGET/.claude/skills"
mkdir -p "$SKILLS"
# Earlier installs used the names demo-record / demo-video and reelkit-record / reelkit-compose:
# drop those links if they point to a kit checkout (a project's own skills are left alone).
for old in demo-record demo-video reelkit-record reelkit-compose; do
    if [[ -L "$SKILLS/$old" && ( "$(readlink "$SKILLS/$old")" == "$KIT"/* || "$(readlink "$SKILLS/$old")" == */skills/reelkit-* ) ]]; then
        rm "$SKILLS/$old"
        echo "  removed old link $SKILLS/$old"
    fi
done
for skill in reelson-record reelson-compose; do
    dest="$SKILLS/$skill"
    if [[ -e "$dest" || -L "$dest" ]]; then
        rm -rf "$dest"
    fi
    ln -s "$KIT/skills/$skill" "$dest"
    echo "  linked $dest"
done

if [[ "$TARGET" != "$HOME" ]]; then
    if [[ ! -f "$TARGET/demo.config.json" ]]; then
        (cd "$TARGET" && reelson init)
    fi
    cat <<GITIGNORE

Add to $TARGET/.gitignore (adjust docs/videos to your videosDir):

    /docs/videos/**/recording.*
    /docs/videos/**/.raw/
    /docs/videos/**/video/
    /docs/videos/**/*.openscreen
GITIGNORE
fi
echo
echo "Done. Try: reelson help"
