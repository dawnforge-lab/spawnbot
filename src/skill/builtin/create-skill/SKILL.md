---
name: create-skill
description: "Create a new skill when you need reusable prompt-level knowledge or procedures. Use when you need to teach yourself a new process, workflow, or domain knowledge that should persist across sessions."
---

# Creating Skills

A skill is a SKILL.md file that contains instructions you can load on demand. Skills are for **knowledge and procedures**, not executable code.

## When to Create a Skill

- You need a repeatable process (e.g., "how to deploy", "how to write a blog post")
- You need domain knowledge that doesn't fit in memory (e.g., API conventions, style guides)
- You want to formalize a workflow the user taught you

## File Format

Create a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: skill-name
description: "One sentence describing when to use this skill. Be specific about trigger phrases."
---

# Skill Title

Instructions, procedures, or knowledge here.
Use clear step-by-step format when describing processes.
```

## Where to Create

Write to `.spawnbot/skills/<skill-name>/SKILL.md`:

```
.spawnbot/skills/
  deploy-app/
    SKILL.md
  write-thread/
    SKILL.md
```

## Requirements

- **name**: lowercase with hyphens, must match directory name
- **description**: Must describe WHEN to use the skill, not just what it does. Use trigger phrases like "Use when the user asks to..." or "Use when you need to..."
- Keep SKILL.md under 2000 words for efficient context loading

## After Creating

Update `.spawnbot/SKILLS.md` with the new skill entry. This is your index — read it to know what you can do.

Example SKILLS.md entry:
```markdown
## deploy-app
Deploy the application to production. Covers staging, testing, and rollback.
```
