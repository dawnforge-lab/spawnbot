# GitHub Workspace

Your agent directory is a git repository. Your identity, configuration, and skills are version-controlled. Runtime data and credentials are not.

## Committed (version-controlled)

- `config/SOUL.yaml` — your identity and personality
- `config/CRONS.yaml` — your scheduled jobs
- `config/integrations.yaml` — integration settings
- `config/GOALS.yaml` — your goals (if present)
- `config/PLAYBOOK.yaml` — your playbook (if present)
- `config/agent/agent.yaml` — Kimi CLI agent definition
- `config/agent/sub.yaml` — subagent definition
- `config/agent/system.md` — system prompt template
- `skills/` — all skill documents
- `README.md` — project readme

## Gitignored (never commit)

- `.env` — API tokens and secrets
- `data/` — database, logs, rendered configs, PID files

## Git Workflow

### After modifying config

When you update SOUL.yaml, CRONS.yaml, or other config files:

```bash
git add config/
git commit -m "Update: <what changed and why>"
git push
```

### After creating or editing skills

```bash
git add skills/
git commit -m "Add/update <skill-name> skill"
git push
```

### After spawnbot update

When `spawnbot update` regenerates framework template files (system.md, agent.yaml), commit the changes:

```bash
git add config/agent/
git commit -m "Update framework templates via spawnbot update"
git push
```

### Creating a branch for experimental work

```bash
git checkout -b experiment/<description>
# ... make changes ...
git add .
git commit -m "Experiment: <description>"
git checkout main
```

## GitHub CLI (gh)

If your repo is on GitHub, use `gh` for GitHub operations:

```bash
gh issue list                                    # List open issues
gh issue create --title "..." --body "..."       # Create an issue
gh pr create --title "..." --body "..."          # Create a pull request
gh pr list                                       # List open PRs
gh release create v1.0 --notes "..."             # Create a release
```

## Branch Jobs

When a cron job has `workspace: true` in CRONS.yaml, you receive a workspace job prompt with branch instructions. Follow this workflow:

1. Create the branch: `git checkout -b job/<name>-<date>`
2. Do the work described in the prompt
3. Stage and commit: `git add -A && git commit -m "Job: <name> — <summary>"`
4. Create a PR: `gh pr create --title "Job: <name>" --body "<what you did>"`
5. Return to main: `git checkout main`

### PR Body Format

Write a clear summary in the PR body:
- What the job prompt asked for
- What you did (list specific actions)
- Any issues found or decisions made
- Files changed and why

### Working on External Projects

If a workspace job has a `project` field, the branch is created in that project's repo — not in your agent directory. Your agent repo manages your identity and config; the project repo holds the deliverables.

```yaml
crons:
  weekly_review:
    workspace: true
    project: /home/user/work/my-app   # any path to a git repo
    prompt: "Review codebase, fix lint errors, update tests."
```

When you receive a project workspace job:
1. `cd` to the project directory
2. Create branch, do work, commit, PR — all in the project repo
3. Return to your agent directory when done

### Branch Naming

- Automated jobs: `job/<cron-name>-<YYYY-MM-DD>`
- Manual tasks: `task/<description>`
- Experiments: `experiment/<description>`

## GitHub Webhooks

If configured, the daemon receives GitHub webhook notifications for:
- PR merged, closed, or opened
- PR reviews (approved, changes requested)
- New issues

These arrive as low-priority `[GitHub]` input items so you stay informed about repo activity.

## Rules

- Commit config changes with clear messages explaining WHY, not just WHAT
- Never commit `.env` or any file containing API tokens
- Keep main branch clean — use feature branches for experiments
- After `spawnbot update` regenerates framework files, commit the updates
