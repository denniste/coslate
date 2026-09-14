#!/usr/bin/env bash
#
# rename.sh — rename the project everywhere.
#
#   bash scripts/rename.sh <new-name> [--display <DisplayName>] [--force] [--dry-run]
#
# The project name is not final, so this has to be reliable. It rewrites every
# occurrence of the four casings the name appears in:
#
#   inkscene        -> <slug>          (package names, ids, storage keys, css)
#   InkScene        -> <PascalCase>    (prose, class names, titles)
#   INKSCENE        -> <UPPER_SNAKE>   (constants, env vars)
#   @inkscene/      -> @<slug>/        (npm scope)
#
# <PascalCase> is derived from the slug by capitalising each dash/underscore
# segment, which cannot express brands like "CoSlate" from the slug "coslate".
# Pass --display to state the prose casing explicitly.
#
# It never touches node_modules, dist, .git, .pnpm-store, .artifacts or .tsbuild,
# and it rewrites its own OLD_* constants on success, so it stays re-runnable.

set -euo pipefail

OLD_SLUG='coslate'
OLD_PASCAL='CoSlate'
OLD_UPPER='COSLATE'
OLD_SCOPE='@coslate/'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF_REL='scripts/rename.sh'

die() { echo "rename: $*" >&2; exit 2; }

FORCE=0
DRY_RUN=0
NEW_NAME=''
DISPLAY=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --display)
      shift
      [ "$#" -gt 0 ] || die "--display needs a value, e.g. --display CoSlate"
      DISPLAY="$1"
      ;;
    --display=*) DISPLAY="${1#--display=}" ;;
    -h|--help)
      sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [ -n "$NEW_NAME" ]; then
        die "unexpected extra argument '$1'"
      fi
      NEW_NAME="$1"
      ;;
  esac
  shift
done

# ---------------------------------------------------------------- validation

[ -n "$NEW_NAME" ] || die "missing project name. usage: bash scripts/rename.sh <new-name> [--force] [--dry-run]"

case "$NEW_NAME" in
  */*|*\\*) die "name must not contain a path separator: '$NEW_NAME'" ;;
esac

# Letters, digits, dot, dash and underscore only — and it must contain a letter.
case "$NEW_NAME" in
  *[!A-Za-z0-9._-]*) die "name may only contain letters, digits, '.', '-' and '_': '$NEW_NAME'" ;;
esac
case "$NEW_NAME" in
  *[A-Za-z]*) : ;;
  *) die "name must contain at least one letter: '$NEW_NAME'" ;;
esac

[ "$(printf '%s' "$NEW_NAME" | tr '[:upper:]' '[:lower:]')" = "$OLD_SLUG" ] && die "name is already '$OLD_SLUG'"

cd "$ROOT"

# Refuse to run on a dirty working tree. Only checked when this directory is
# itself a git repository root, so the script never reaches into a parent repo.
if [ -d "$ROOT/.git" ] && command -v git >/dev/null 2>&1; then
  if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null || true)" ] && [ "$FORCE" -ne 1 ]; then
    die "working tree is dirty; commit or stash first, or pass --force"
  fi
fi

# ------------------------------------------------------------------ casings

SLUG="$(printf '%s' "$NEW_NAME" | tr '[:upper:]' '[:lower:]')"
SCOPE="@${SLUG}/"
UPPER="$(printf '%s' "$SLUG" | tr '[:lower:]-' '[:upper:]_')"

if [ -n "$DISPLAY" ]; then
  case "$DISPLAY" in
    *[!A-Za-z0-9._-]*) die "display name may only contain letters, digits, '.', '-' and '_': '$DISPLAY'" ;;
  esac
  case "$DISPLAY" in
    *[A-Za-z]*) : ;;
    *) die "display name must contain at least one letter: '$DISPLAY'" ;;
  esac
  PASCAL="$DISPLAY"
else
  PASCAL="$(printf '%s' "$SLUG" | awk -F'[-_]' '{ for (i = 1; i <= NF; i++) printf "%s%s", toupper(substr($i, 1, 1)), substr($i, 2) }')"
fi

[ -n "$PASCAL" ] || die "could not derive a PascalCase name from '$NEW_NAME'"
[ "$PASCAL" = "$SLUG" ] || true

echo "rename: $OLD_SLUG -> $SLUG"
echo "        $OLD_PASCAL -> $PASCAL"
echo "        $OLD_UPPER -> $UPPER"
echo "        $OLD_SCOPE -> $SCOPE"

# ------------------------------------------------------------------- targets

mapfile -t FILES < <(
  grep -rIl \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude-dir=.git \
    --exclude-dir=.pnpm-store \
    --exclude-dir=.artifacts \
    --exclude-dir=.tsbuild \
    --exclude-dir=coverage \
    -e "$OLD_SLUG" -e "$OLD_PASCAL" -e "$OLD_UPPER" \
    . 2>/dev/null | sed 's|^\./||' | sort
)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "rename: nothing to do — no file under $ROOT mentions the project name."
  exit 0
fi

# `&` and `\` are special in a sed replacement.
escape_replacement() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }

R_SCOPE="$(escape_replacement "$SCOPE")"
R_PASCAL="$(escape_replacement "$PASCAL")"
R_UPPER="$(escape_replacement "$UPPER")"
R_SLUG="$(escape_replacement "$SLUG")"

total_subs=0
changed=0

for file in "${FILES[@]}"; do
  if [ "$file" = "$SELF_REL" ]; then
    printf '  skip  %s (the rename helper itself stays name-agnostic)\n' "$file"
    continue
  fi

  # Count every occurrence once, case-insensitively: each one is rewritten by
  # exactly one of the ordered expressions below.
  occurrences="$(grep -oi "$OLD_SLUG" "$file" | wc -l | tr -d ' ')"
  [ "$occurrences" -gt 0 ] || continue

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  would rewrite %-52s %s substitution(s)\n' "$file" "$occurrences"
    total_subs=$((total_subs + occurrences))
    changed=$((changed + 1))
    continue
  fi

  sed -i \
    -e "s|$OLD_SCOPE|$R_SCOPE|g" \
    -e "s|$OLD_PASCAL|$R_PASCAL|g" \
    -e "s|$OLD_UPPER|$R_UPPER|g" \
    -e "s|$OLD_SLUG|$R_SLUG|g" \
    "$file"

  printf '  rewrite %-50s %s substitution(s)\n' "$file" "$occurrences"
  total_subs=$((total_subs + occurrences))
  changed=$((changed + 1))
done

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "rename: dry run — would change $changed file(s), $total_subs substitution(s)."
else
  echo "rename: changed $changed file(s), $total_subs substitution(s)."

  # Point our own OLD_* constants at the new name. Without this the next rename
  # would grep for the previous name and report "nothing to do".
  sed -i \
    -e "s|^OLD_SLUG=.*|OLD_SLUG='$SLUG'|" \
    -e "s|^OLD_PASCAL=.*|OLD_PASCAL='$PASCAL'|" \
    -e "s|^OLD_UPPER=.*|OLD_UPPER='$UPPER'|" \
    -e "s|^OLD_SCOPE=.*|OLD_SCOPE='$SCOPE'|" \
    "$SELF_REL"
  echo "rename: helper re-armed for the next rename ($OLD_SLUG -> $SLUG)."
  echo "rename: next steps -> pnpm install && pnpm typecheck && pnpm test && pnpm build"
fi

case "$NEW_NAME" in
  [._]*)
    echo "rename: warning — '$NEW_NAME' starts with '.' or '_', which npm rejects for package names." >&2
    echo "        The workspace will not install until you pick another name." >&2
    ;;
esac
