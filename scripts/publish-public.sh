#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# Publishes a release to the public repository: one commit per release, made from the private
# repository's current commit minus the excluded paths; the private history stays private.
# The working folder, the index and the branches are not touched (a temporary index builds the
# release's tree; git commit-tree makes the commit on top of the public repo's last release).
#
#   scripts/publish-public.sh <version>            show what would be published
#   scripts/publish-public.sh <version> --push     publish: commit, tag v<version>, and a GitHub
#                                                  release with build/thundernotes-<version>.xpi
set -eu

PUBLIC_URL="https://github.com/flofrie/thundernotes.git"
PUBLIC_REPO="flofrie/thundernotes"
EXCLUDE="spikes"
NAME="Florian Friedrich"
EMAIL="flofrie@users.noreply.github.com"

version="${1:?usage: scripts/publish-public.sh <version> [--push]}"
push="${2:-}"
root=$(git rev-parse --show-toplevel)
cd "$root"

[ -z "$(git status --porcelain)" ] || { echo "publish: uncommitted changes; commit first" >&2; exit 1; }
manifest_version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' packages/thunderbird/manifest.json | head -1)
[ "$manifest_version" = "$version" ] || { echo "publish: manifest.json says $manifest_version, not $version" >&2; exit 1; }

# The public repo must be itself: after a rename GitHub redirects an old name to the renamed
# (private) repository, which would publish into the private history.
[ "$(gh repo view "$PUBLIC_REPO" --json nameWithOwner,visibility -q '.nameWithOwner + " " + .visibility')" = "$PUBLIC_REPO PUBLIC" ] ||
  { echo "publish: $PUBLIC_REPO isn't a public repository of its own (a redirect?)" >&2; exit 1; }

# The public repo's last release, if any (nothing yet: this one becomes its first commit).
# Without its tags: the public v<version> tags point at public commits, the private ones at private commits.
git remote get-url public >/dev/null 2>&1 || git remote add public "$PUBLIC_URL"
git config remote.public.tagOpt --no-tags
parent=""
if git ls-remote --exit-code --heads public main >/dev/null 2>&1; then
  git fetch -q public main
  parent=$(git rev-parse public/main)
fi

# This commit's files minus the excluded paths, as a tree.
index=$(mktemp -t thundernotes-publish)
trap 'rm -f "$index"' EXIT
GIT_INDEX_FILE="$index" git read-tree HEAD
# shellcheck disable=SC2086
GIT_INDEX_FILE="$index" git rm -r -q --cached --ignore-unmatch $EXCLUDE
tree=$(GIT_INDEX_FILE="$index" git write-tree)

if [ -n "$parent" ] && [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
  echo "publish: nothing changed since the last public release"
  exit 0
fi

echo "publish: ThunderNotes $version from $(git rev-parse --short HEAD), without: $EXCLUDE"
if [ -n "$parent" ]; then
  git diff --stat "$parent" "$tree" | tail -1
else
  echo "publish: first public commit, $(git ls-tree -r "$tree" | wc -l | tr -d ' ') files"
fi
if [ "$push" != "--push" ]; then
  echo "publish: dry run; add --push to publish"
  exit 0
fi

commit=$(GIT_AUTHOR_NAME="$NAME" GIT_AUTHOR_EMAIL="$EMAIL" GIT_COMMITTER_NAME="$NAME" GIT_COMMITTER_EMAIL="$EMAIL" \
  git commit-tree "$tree" ${parent:+-p "$parent"} -m "ThunderNotes $version")
git push -q public "$commit:refs/heads/main" "$commit:refs/tags/v$version"
echo "publish: pushed $commit to $PUBLIC_REPO (main, v$version)"

xpi="build/thundernotes-$version.xpi"
if [ -f "$xpi" ]; then
  gh release create "v$version" "$xpi" -R "$PUBLIC_REPO" --title "ThunderNotes $version" --notes "Install: download the .xpi, then in Thunderbird Tools → Add-ons and Themes → gear icon → Install Add-on From File…"
else
  echo "publish: no $xpi (run npm run package first); no GitHub release made"
fi
