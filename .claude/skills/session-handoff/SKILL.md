---
name: session-handoff
description: Create or update a next-session handoff that preserves user prompts verbatim, separates minimal assistant context, and works for both Codex and Claude continuation workflows.
---

# Session Handoff

Use this skill when the user asks to preserve the session for a future assistant, capture all prompts/messages, avoid summarizing user instructions, or create a handoff for Codex and Claude.

## Workflow

1. Capture every user prompt visible in the current context verbatim.
2. Do not correct spelling, punctuation, capitalization, Markdown, XML-like wrappers, or line breaks inside copied user prompts.
3. Add only short assistant context when needed to explain actions taken between user prompts.
4. Clearly separate assistant context from verbatim user text.
5. State when earlier messages are not visible and therefore cannot be copied.
6. Do not delegate transcript capture to another agent.

## Output Structure

Create or update a Markdown handoff artifact with:

- A short heading naming it as a session handoff.
- A concise procedure for the next assistant.
- Minimal context about actions already taken.
- A `Verbatim User Prompts` section with each user prompt in its own fenced `text` block.

## Codex And Claude Notes

- For Codex, mention that repo `AGENTS.md` instructions and applicable Codex skills remain active.
- For Claude, mention that repo `CLAUDE.md` instructions remain active.
- If `CLAUDE.md` points at `AGENTS.md`, say so in context rather than duplicating extra interpretation.
