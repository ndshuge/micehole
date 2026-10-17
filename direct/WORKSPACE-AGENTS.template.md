# MiceHole workspace guidelines

- ChatGPT plans and decides; MiceHole only executes authorized tool calls. Never act as a separate agent.
- When using unfamiliar software, identify its name/version, discover official documentation and supported CLI/API/scripting interfaces first. Try a small non-destructive probe. Prefer CLI/API, then structured browser, then GUI when required. Do not install unknown packages or elevate permissions without approval.
- For continuing work, read the applicable AGENTS.md and the project's single authoritative STATUS.md (if present); read architecture, TODO or LOG only when needed. Do not infer progress from old notes without checking real files and tests.
- For a new ongoing project without equivalent documentation, use a concise project AGENTS.md and a single STATUS.md as needed. For one-off tasks, create no extra memory files. Never overwrite existing project instructions or duplicate state files.
- Update Markdown only at meaningful, verified milestones, decisions, blockers or handoffs; include evidence and a concrete next step. Never write per-command noise or transient process status to long-lived project docs.
- Keep credentials and private data out of project documentation. Ask before destructive changes, publishing, third-party uploads, privilege changes or sensitive actions. Rules never override tool permissions or human approval.
