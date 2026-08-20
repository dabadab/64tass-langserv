#!/usr/bin/env bash
#
# Cut a release from whatever is in the working tree.
#
# Takes the version from package.json, verifies the tree, asks for confirmation,
# then commits everything pending as "Release v<version>", tags that commit with
# an annotated tag of the same name and message, and pushes both to origin.
#
# The tag is annotated (-a) rather than lightweight on purpose: only an annotated
# tag is a real object, so only it can carry the tagger, the message and - with
# tag.gpgsign set, as this repo has - a signature. It also matters downstream,
# because vscode:prepublish derives the published version from `git describe`.

set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
MESSAGE="Release ${TAG}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    echo "error: tag ${TAG} already exists - bump the version in package.json first" >&2
    exit 1
fi

# The same three checks CI runs, in the same order, so a tag cannot be pushed
# only to fail the release workflow minutes later. REQUIRE_TASS makes the
# integration suites a hard failure instead of a silent skip - a release should
# not be verified by a run that quietly skipped every compiler test.
echo "verifying ${TAG}..."
yarn lint
yarn typecheck
REQUIRE_TASS=1 yarn test

echo
echo "  version : ${VERSION}"
echo "  tag     : ${TAG} (annotated)"
echo "  branch  : $(git rev-parse --abbrev-ref HEAD) -> origin"
if [ -n "$(git status --porcelain)" ]; then
    echo "  commit  : ${MESSAGE}"
    git status --short | sed 's/^/            /'
else
    echo "  commit  : none pending, tagging $(git rev-parse --short HEAD)"
fi
echo

# Asked before anything is changed, not just before the push: answering no here
# leaves the repository exactly as it was, with nothing to undo.
read -r -p "release this? [y/N] " reply
case "${reply}" in
    [Yy]*) ;;
    *) echo "aborted - nothing committed, tagged or pushed"; exit 1 ;;
esac

# Nothing pending is fine: the release commit may already be made, and this
# should still tag and push it.
if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit -m "${MESSAGE}"
fi

git tag -a "${TAG}" -m "${MESSAGE}"

git push origin HEAD
git push origin "${TAG}"

echo "released ${TAG}"
