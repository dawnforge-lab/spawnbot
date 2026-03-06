---
name: coding-best-practices
description: "Best practices for coding tasks. Loaded automatically for software engineering work. Covers tool usage, code style, task workflow, and safety."
---

# Coding Best Practices

## Tool Usage

- Call multiple independent tools in parallel to maximize efficiency. Only sequence calls when one depends on the result of another.
- Prefer dedicated tools over bash: use Read instead of cat/head/tail, Edit instead of sed/awk, Write instead of echo/heredoc, Glob instead of find, Grep instead of grep/rg.
- Reserve Bash for actual system commands and terminal operations that require shell execution.
- Use the Task tool with specialized agents for broad codebase exploration. Use Glob/Grep directly for targeted searches (specific file, class, or function).
- When WebFetch returns a redirect, follow it immediately with a new request.

## Code Style

- Follow existing project conventions: formatting, naming, structure, framework choices, typing, architectural patterns.
- Verify a library/framework is already used in the project before introducing it. Check imports, package.json, requirements.txt, etc.
- Add comments sparingly — focus on *why*, not *what*. Never use comments to communicate with the user.
- Prefer editing existing files over creating new ones. Don't create files unless necessary.

## Task Workflow

1. **Understand** — Read relevant code, search for context, understand the problem before acting.
2. **Plan** — Break complex tasks into steps. Share a concise plan if it helps the user follow along.
3. **Implement** — Make small, testable, incremental changes.
4. **Verify** — Run the project's tests, linter, and type checker after making changes. Don't assume standard commands — check README or package config.

## Safety

- Never introduce code that exposes, logs, or commits secrets, API keys, or credentials.
- Explain commands that modify the filesystem or system state before executing them.
- Don't revert changes unless asked or they caused an error.
- Use absolute paths when working with file tools.

## References

When referencing code, use `file_path:line_number` format (e.g. `src/server.ts:42`) for easy navigation.
