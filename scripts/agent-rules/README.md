# Agent Rules Script

This script keeps path-specific agent instructions ("rules") in one place, [.agents/rules/](../../.agents/rules/), and writes a copy of each rule to every harness's own rules folder, with the file name and frontmatter that harness expects.

At a high level, the script:

- Reads every `*.md` file in the source folder (except `README.md`) and validates its `paths` frontmatter.
- Writes a copy of each rule to every configured target (default: Claude, GitHub Copilot and Cursor), formatted with the project's Prettier config so lint-staged leaves the copies unchanged.
- Deletes copies whose source rule no longer exists. Only files the script generated are ever deleted or overwritten. It recognizes them by their `<!-- Generated from ... -->` line.
- Updates a generated index of the rules in [AGENTS.md](../../AGENTS.md) between the `<!-- agent-rules:start -->` and `<!-- agent-rules:end -->` markers. Codex has no rule folders, so the index tells it which rule file to read for which paths.

The copies are ordinary files that are committed to git, so collaborators don't need to run anything.

## Usage

```bash
npm run agent-rules
```

Run it after you add, edit, rename or remove a rule, and commit the changed copies together with the rule.

To only check whether everything is in sync, without writing anything (exits with code 1 if not):

```bash
npm run agent-rules:check
```

If any rule is invalid, the script reports it and writes nothing, so a typo can't delete that rule's copies.

## Writing Rules

- Only edit files in `.agents/rules/`. Edits to the copies are overwritten on the next run.
- Every rule needs a `paths` list of globs. Always-on instructions belong in `AGENTS.md` (outside the generated section), which Claude, GitHub Copilot, Cursor and Codex all read. An always-on rule would otherwise be loaded twice.
- Other frontmatter keys (for example `description`) are copied to every target.

```markdown
---
paths:
  - "force-app/**/classes/**"
  - "scripts/**/*.apex"
---

Rule content...
```

## Configuration

The script reads [config/agent-rules-config.yaml](../../config/agent-rules-config.yaml). Paths are resolved from the workspace root.

The first line links the file to [config/yaml-schemas/agent-rules-config.schema.json](../../config/yaml-schemas/agent-rules-config.schema.json). With the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) installed, VS Code shows each option's documentation on hover, suggests completions, and flags invalid values. Keep the schema in sync when options change.

- `source`: the folder with the rules. Defaults to `.agents/rules/`.
- `targets`: the harnesses that get a copy of every rule. Defaults to Claude and GitHub Copilot. Each target has:
  - `folder`: where the copies are written.
  - `fileName`: the file name of each copy. `{name}` is the rule's file name without `.md`, for example `"{name}.instructions.md"`. Must end with `.md` or `.mdc`.
  - `frontmatter`: the keys written to each copy. `$paths` writes the rule's paths as a YAML list, `$pathsCsv` as one comma-separated string. Any other value is written as is.
- `indexFile`: the file that gets the generated rules index. Defaults to `AGENTS.md`; set it to `""` to skip the index.

To support another harness, add a target. For example:

```yaml
- folder: .windsurf/rules/ # Windsurf
  fileName: "{name}.md"
  frontmatter:
    trigger: glob
    globs: $pathsCsv
```

Removing a target doesn't delete its existing copies. Delete that folder manually.
