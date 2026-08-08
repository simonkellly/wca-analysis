#!/usr/bin/env bash
# Keep Codespaces clones shallow and never fetch the huge `api` deployment branch.
#
# Codespaces shallow-clones the selected branch on create, but may later widen
# the fetch (background unshallow / VS Code autofetch). This script locks fetch
# to the current branch and excludes `api`.

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

branch=$(git branch --show-current || true)
if [[ -z "$branch" ]]; then
  echo "setup-git: detached HEAD, skipping branch lock"
  exit 0
fi

# Only ever fetch the branch this codespace was created from.
git config --replace-all remote.origin.fetch "+refs/heads/${branch}:refs/remotes/origin/${branch}"
git config --add remote.origin.fetch '^refs/heads/api'
git remote set-branches origin "$branch" 2>/dev/null || true

# Drop api if it was already fetched.
git branch -dr origin/api 2>/dev/null || true
git update-ref -d refs/remotes/origin/api 2>/dev/null || true

if git rev-parse --is-shallow-repository 2>/dev/null | grep -q true; then
  echo "setup-git: shallow clone, branch=${branch}, api excluded"
else
  echo "setup-git: branch=${branch}, api excluded (not shallow — may have been widened already)"
fi
