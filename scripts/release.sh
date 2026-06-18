#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PACKAGES="tunnel go2rtc nats"

usage() {
  cat <<EOF
Usage: scripts/release.sh <package> <version> [--yes] [--skip-checks]

Packages: $PACKAGES

The <version> is the upstream release tag to ship (leading "v" optional).
Prerelease versions are allowed (e.g. go2rtc's 1.9.14-cui.9).

Examples:
  scripts/release.sh tunnel 1.0.4
  scripts/release.sh go2rtc 1.9.14-cui.10

Pushes a tag <package>-v<version>; the release workflow then fetches the upstream
binaries, repacks them into per-platform packages and publishes to npm via OIDC.

Options:
  --yes, -y       Push without the confirmation prompt.
  --skip-checks   Skip verifying that the upstream release exists.
EOF
  exit 1
}

PKG="${1:-}"
SPEC="${2:-}"
YES=false
SKIP_CHECKS=false
for arg in "${@:3}"; do
  case "$arg" in
    --yes | -y) YES=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    *) echo "Unknown option: $arg"; usage ;;
  esac
done

[ -z "$PKG" ] && usage
[ -z "$SPEC" ] && usage

case " $PACKAGES " in
  *" $PKG "*) ;;
  *) echo -e "${RED}Unknown package '$PKG'. Known: $PACKAGES${NC}"; exit 1 ;;
esac

DIR="packages/$PKG"
NAME="@camera.ui/$PKG"

cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}Working tree not clean - commit or stash first.${NC}"
  exit 1
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo -e "${RED}Not on main (on '$branch').${NC}"
  exit 1
fi
git fetch -q origin main || true
if [ -n "$(git rev-list HEAD..origin/main 2>/dev/null)" ]; then
  echo -e "${RED}Local main is behind origin/main - pull first.${NC}"
  exit 1
fi

cur="$(node -p "require('./$DIR/package.json').version")"

# Normalise: strip a leading "v"; the package version carries no "v".
NEW="${SPEC#v}"

# semver core with optional prerelease/build metadata (e.g. 1.9.14-cui.9)
if ! echo "$NEW" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+([-+].+)?$'; then
  echo -e "${RED}Invalid version '$NEW' (expected X.Y.Z or X.Y.Z-prerelease).${NC}"
  exit 1
fi

TAG="$PKG-v$NEW"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Tag $TAG already exists.${NC}"
  exit 1
fi

echo -e "${CYAN}Releasing $NAME ($DIR): $cur -> $NEW (tag $TAG)${NC}"

if [ "$SKIP_CHECKS" = false ]; then
  REPO="$(node -p "require('./$DIR/package.json').camerauiBinary.releaseRepo")"
  echo -e "${YELLOW}Pre-flight: verifying upstream release $REPO@v$NEW exists...${NC}"
  status="$(curl -fsS -o /dev/null -w '%{http_code}' "https://api.github.com/repos/$REPO/releases/tags/v$NEW" || true)"
  if [ "$status" != "200" ]; then
    echo -e "${RED}Upstream release v$NEW not found at $REPO (HTTP $status). Use --skip-checks to override.${NC}"
    exit 1
  fi
  echo -e "${GREEN}Upstream release found.${NC}"
fi

# Update the package version, the upstream tag in the config, and the pinned
# optionalDependencies — so the committed manifest matches what CI will publish.
node -e "
  const f = './$DIR/package.json';
  const p = require(f);
  p.version = '$NEW';
  p.camerauiBinary.version = 'v$NEW';
  for (const dep of Object.keys(p.optionalDependencies || {})) {
    p.optionalDependencies[dep] = '$NEW';
  }
  require('fs').writeFileSync(f, JSON.stringify(p, null, 2) + '\n');
"

git add "$DIR/package.json"
git commit -q -m "release($PKG): v$NEW"
echo -e "${GREEN}Committed version bump.${NC}"

git tag "$TAG"
echo -e "${GREEN}Created tag $TAG.${NC}"

if [ "$YES" = false ]; then
  printf "Push main + %s and trigger the release? [y/N] " "$TAG"
  read -r ans
  case "$ans" in
    y | Y | yes) ;;
    *)
      git tag -d "$TAG" >/dev/null
      git reset -q --hard HEAD~1
      echo "Aborted - tag and bump commit were undone locally."
      exit 0
      ;;
  esac
fi

git push -q origin main
git push -q origin "$TAG"
echo -e "${GREEN}Pushed. Watch the release workflow under the repo's Actions tab.${NC}"
