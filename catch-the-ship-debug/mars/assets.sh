#!/bin/bash
# Pushes the PR screenshots as one image-only orphan commit on branch vineeth/pr-assets-<PR> (never merged),
# without touching the worktree's index. Prints the commit SHA. Usage: assets.sh <PR number> <image>...
set -euo pipefail
pr=$1
shift
files=()
for f in "$@"; do files+=("$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"); done
repo=~/dev/scratch/catch-the-ship-mars
export GIT_INDEX_FILE=~/.cache/ctb-assets-index
rm -f "$GIT_INDEX_FILE"
cd "$repo"
for f in "${files[@]}"; do
  blob=$(git hash-object -w "$f")
  git update-index --add --cacheinfo "100644,$blob,$(basename "$f")"
done
tree=$(git write-tree)
export GIT_AUTHOR_NAME='Vineeth Sendilraj' GIT_AUTHOR_EMAIL='vineethsendilraj@gmail.com'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
commit=$(git commit-tree "$tree" -m "Screenshots for PR #$pr (not for merge)")
rm -f "$GIT_INDEX_FILE"
git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin "$commit:refs/heads/vineeth/pr-assets-$pr" >&2
echo "$commit"
