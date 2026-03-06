# Skill Creation

How to create, manage, and organize skills.

## What Skills Are

Skills are on-demand knowledge documents. Each skill is a markdown file at `skills/<name>/SKILL.md` that you read before performing a specific kind of work. Skills are not loaded into every conversation — you read them when you need them, keeping token usage efficient.

## When to Create a Skill

Create a skill when you learn something that:
- You'll need to reference again across multiple conversations
- Involves specific APIs, protocols, or procedures with exact syntax
- Would be hard to reconstruct from scratch each time
- Represents domain expertise (e.g., how a particular service works)

## Managing Skills

Use the MCP tools:

- `skill_list` — see all installed skills with previews
- `skill_read({ name: "skill-name" })` — load a skill's full content
- `skill_create({ name: "skill-name", content: "# ..." })` — create or overwrite a skill
- `skill_remove({ name: "skill-name" })` — delete a skill

## Writing Good Skills

### Structure

```markdown
# Skill Title

Brief description of what this skill covers.

## Section 1

Clear instructions...

### Subsection

Details, examples, code snippets...

## Section 2

More instructions...

## Tips

- Practical advice
- Common pitfalls
```

### Guidelines

- **One domain per skill** — don't mix unrelated topics
- **Include working examples** — show complete, copy-pasteable code or commands
- **Be specific** — exact API signatures, import paths, parameter types
- **Keep it concise** — include what's needed to do the work, skip background theory
- **Use headers** — organize content so you can scan quickly

### Naming

Skill names must be lowercase alphanumeric with hyphens or underscores:
- `api-integration`
- `data_processing`
- `telegram-bot`

### Example

```
skill_create({
  name: "csv-processing",
  content: "# CSV Processing\n\nHow to parse, transform, and generate CSV files.\n\n## Reading CSV\n\n```js\nimport { createReadStream } from 'fs';\nimport { parse } from 'csv-parse';\n...\n```\n\n## Writing CSV\n\n..."
})
```
