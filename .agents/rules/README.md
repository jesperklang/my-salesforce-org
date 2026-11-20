# Agent Rules

This folder is the source of truth for path-specific agent instructions ("rules"). Each rule applies only when an agent works on files matching its `paths` globs.

| Rule                     | Applies to                                                                 |
| ------------------------ | -------------------------------------------------------------------------- |
| [SF_APEX.md](SF_APEX.md) | `force-app/**/classes/**`, `force-app/**/triggers/**`, `scripts/**/*.apex` |
| [SF_LWC.md](SF_LWC.md)   | `force-app/**/lwc/**`                                                      |

## How it works

The [Agent Rules script](../../scripts/agent-rules/README.md) copies every rule here into each harness's own rules folder, with the file name and frontmatter that harness expects:

- `.claude/rules/` (Claude)
- `.github/instructions/` (GitHub Copilot)
- `.cursor/rules/` (Cursor)

It also updates the rules index in [AGENTS.md](../../AGENTS.md) for harnesses without rule folders (Codex). Targets are configured in [config/agent-rules-config.yaml](../../config/agent-rules-config.yaml).

## Adding or editing a rule

1. Only edit files in this folder. Edits to the generated copies are overwritten.
2. Give every rule a `paths` list of globs in its frontmatter:

   ```markdown
   ---
   paths:
     - "force-app/**/classes/**"
   ---

   Rule content...
   ```

3. Sync the copies and commit them together with the rule:

   ```bash
   npm run agent-rules
   ```

Always-on instructions don't belong here. Put them in [AGENTS.md](../../AGENTS.md), outside the generated section. This README is ignored by the script.
