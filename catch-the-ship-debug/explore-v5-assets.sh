#!/bin/zsh
# Image-only commit of the PR #16 v5 screenshots on top of vineeth/pr-assets-16, built with a scratch index so the
# worktree's index and branch stay untouched.
set -e
D=/Users/vsendilraj/dev/scratch/catch-the-ship-debug
cd /Users/vsendilraj/dev/scratch/catch-the-ship-explore
BASE=c59a1aa91a49aa2747b4d3a1623447fd37486c76
files=(
  explore-maps-v5-sb-engines-off.jpg explore-maps-v5-sb-engines.jpg
  explore-maps-v5-mars-engines-off.jpg explore-maps-v5-mars-engines.jpg
  explore-maps-v5-sb-nose-off.jpg explore-maps-v5-sb-nose.jpg
  explore-maps-v5-mars-nose-off.jpg explore-maps-v5-mars-nose.jpg
)
for p in entry engines fins ring nose flaps chopsticks tower farm; do files+=(explore-v5-sb-$p.jpg explore-v5-mars-$p.jpg); done
files+=(
  explore-v5-title-sb-card.jpg explore-v5-title-mars-card.jpg
  explore-v5-title-390-card.jpg explore-v5-390-entry.jpg explore-v5-390-engines.jpg explore-v5-390-flaps.jpg
  explore-v5-title-480-card.jpg explore-v5-480-entry.jpg explore-v5-480-engines.jpg
)
export GIT_INDEX_FILE=/tmp/explore-assets-index
rm -f $GIT_INDEX_FILE
git read-tree $BASE
for f in $files; do
  git update-index --add --cacheinfo 100644,$(git hash-object -w $D/$f),$f
done
tree=$(git write-tree)
unset GIT_INDEX_FILE
rm -f /tmp/explore-assets-index
export GIT_AUTHOR_NAME='Vineeth Sendilraj' GIT_AUTHOR_EMAIL=vineethsendilraj@gmail.com
export GIT_COMMITTER_NAME='Vineeth Sendilraj' GIT_COMMITTER_EMAIL=vineethsendilraj@gmail.com
commit=$(git commit-tree $tree -p $BASE -m 'PR #16 screenshots: both maps, Starbase daylight and Mars dusk')
echo "files ${#files} tree $tree commit $commit"
git diff --stat $BASE $commit | tail -3
git push origin ${commit}:refs/heads/vineeth/pr-assets-16
echo "PUSHED $commit"
