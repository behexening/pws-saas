# PR Workflow

All changes to `live_test_server.py` and `backend_v2.js` go through pull requests — not direct commits to main.

## Why

- `live_test_server.py` parsing logic will keep changing before launch. PRs give a clean diff per fix without grepping the whole file.
- `backend_v2.js` is the entire backend in one file. PRs make it easy to see what feature landed when and roll back if needed.
- Keeps main always shippable.

## How

```bash
# 1. Branch off main
git checkout main && git pull
git checkout -b <type>/<short-description>
# e.g. fix/parser-district-names, feat/sms-opt-out, chore/env-validation

# 2. Make commits on the branch
git add <files>
git commit -m "..."

# 3. Push and open PR
git push -u origin <branch>
gh pr create --title "..." --body "..."

# 4. Merge when ready
gh pr merge --squash   # or --merge if you want individual commits
```

## Branch naming

| Prefix | Use |
|---|---|
| `fix/` | Bug fix |
| `feat/` | New feature |
| `chore/` | Deps, config, docs, refactor |
| `parser/` | live_test_server.py changes specifically |

## Scope

Files that **require a PR:**
- `live_test_server.py`
- `backend_v2.js`

Files that **can commit directly to main:**
- `public/` HTML/CSS/JS (frontend tweaks)
- `docs/`
- `CLAUDE.md`
- Data files (`data/`, `public/static/`)
