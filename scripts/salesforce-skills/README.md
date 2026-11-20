# Salesforce Skills Script

This script helps manage Salesforce skill-related data in a repeatable way. It takes the same skills used for Agentforce Vibes and makes them available to other LLMs.

At a high level, the script:

- Reads the skills from the latest release of [Salesforce's official skill repo](https://github.com/forcedotcom/afv-library.git) using `git`.
- Inserts/updates skills in the configured install folder (default `.agents/skills/sf-<upstream-name>/`).
- Prefixes each skill's YAML `name` with `sf-` to match its folder, trimming names longer than 64 characters.
- Updates skill-name references and sibling links in Markdown, preserving upstream URLs and filenames.
- Links each imported skill into every configured symlink folder (default `.claude/skills/sf-<upstream-name>/`).
- Removes ignored or upstream-deleted Salesforce skills and their managed links, without modifying unprefixed skills.

The script is useful to make sure you comply with Salesforce's guidelines as they change over time.

## Usage

- Run the command:

```bash
npm run sf-skills
```

The importer reports configuration and release checks, downloads and checkout, preparation, the number of new or changed skills being installed (unchanged skills are left untouched), removed skills, and skill link synchronization. Like `updateAll`, it redraws its progress list in place: `[ ]` waiting, blue `[>]` running, green `[x]` done, green `[-]` skipped, and red `[!]` errors. Redirected output and terminals that are too small or use `TERM=dumb` get ordinary progress lines instead. Output is coloured when the terminal supports it; set `NO_COLOR=1` to disable colours or `FORCE_COLOR=1` to force them.

## CI

Run the importer with `--ci` to print only `true` or `false` to stdout; progress and errors go to stderr:

```bash
npm run --silent sf-skills:ci
```

The value is `true` if the run adds, updates, or removes a skill, changes a managed link, or creates or updates the configuration. Temporary files are excluded. Failures return a nonzero exit code and no boolean.

When `GITHUB_OUTPUT` is set, the importer also writes a GitHub Actions step output named `changed` on successful runs, with or without `--ci`:

```yaml
- id: skills
  run: npm run --silent sf-skills:ci
- if: steps.skills.outputs.changed == 'true'
  run: echo "Salesforce skills changed"
```

### Daily update workflow

[.github/workflows/update-salesforce-skills.yml](../../.github/workflows/update-salesforce-skills.yml) runs the importer every day at 05:00 UTC, and you can also start it manually from the Actions tab. It:

1. Checks out `maintenance/skills`, first merging `main` into it if the branch already exists, or creates the branch from `main`. If the merge conflicts, the run fails so you can resolve the conflicts manually.
2. Runs the importer and, if tracked files changed, commits them with the message `Update Salesforce skills to <version>`.
3. Pushes the branch and opens a pull request to `main` with the importer output (new, updated and removed skills) in the description. If a pull request is already open, the new output is appended to its description.

Creating the pull request requires **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests** to be enabled in the repository.

The imported skills in `.agents/skills/sf-*` are committed; the link folders (`.claude/skills/sf-*`, `.github/skills/sf-*`) are ignored, because Git stores Windows junctions as full copies and Linux symlinks as plain files on Windows. Run `npm run sf-skills` after pulling to recreate missing links. To keep the committed skills identical to upstream on every platform, the importer clones without line-ending conversion, [.gitattributes](../../.gitattributes) disables line-ending conversion for the skills, and [.prettierignore](../../.prettierignore) excludes them from formatting.

## Configuration

The script reads [config/salesforce-skills-config.yaml](../../config/salesforce-skills-config.yaml).

The YAML configuration supports `#` comments, including inline comments. Quote wildcard patterns that begin with `*` so YAML does not interpret them as aliases.

The first line links the file to [config/yaml-schemas/salesforce-skills-config.schema.json](../../config/yaml-schemas/salesforce-skills-config.schema.json). With the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) installed, VS Code shows each option's documentation on hover, suggests completions, and flags invalid values. Keep the schema in sync when options change.

Supported options:

- `installedVersion`: records the imported Salesforce skills `version` and its GitHub publication `released` date (`YYYY-MM-DD`, UTC). The script displays the date in parentheses after the version. When a release is imported, only this value is updated in place, so comments and formatting elsewhere in the file are preserved.
- `ignoredSkills`: excludes Salesforce skills by their **prefixed skill name**, for example `sf-omnistudio*` excludes every imported skill whose name starts with `sf-omnistudio`. Use `*` as a wildcard within the name.
- `saveOptions`: controls where skills are installed and linked. Paths are resolved from the workspace root (the folder you run the script from); absolute paths also work.
  - `source`: the folder the skills are installed into. Defaults to `.agents/skills/`.
  - `symlinks`: folders that get a link to each installed skill, for example `.claude/skills/` for Claude and `.github/skills/` for GitHub Copilot. Defaults to `[".claude/skills/"]`; use `[]` to create no links. A folder can't be listed twice or match `source`.

The `sf-` namespace is reserved for this importer: any folder starting with `sf-` in the install folder is treated as an imported Salesforce skill and can be updated or removed, so don't give your own skills that prefix. All additions, comparisons, updates, deletions, and `ignoredSkills` patterns use the prefixed (and, if needed, trimmed) names. Existing folders without the prefix, including older imports that used the longer `sf-skill-` prefix, are left untouched; review and remove any old imports manually to avoid duplicate skills.

Skill links are synchronized in every `symlinks` folder on every run ("Synchronize skill links"), recreating missing Salesforce skill links and removing links left behind by removed skills. An empty Salesforce installation is imported again rather than skipped. Existing files, directories, or links to unrelated targets in a link folder are never overwritten: the script checks all link folders first and reports a conflict so you can move them aside.

Changing `saveOptions` doesn't clean up previous locations. When `source` changes, the skills are installed in the new folder, and existing links that point to the same skill in the old folder are re-pointed; remove the old install folder manually. When a folder is removed from `symlinks`, its links are left untouched; delete them manually if you no longer need them.

Set `SALESFORCE_SKILLS_REF` to force an import from a particular tag or branch; this does not change `installedVersion`. Set `SALESFORCE_SKILLS_REPO` to override the upstream repository. Set `GITHUB_TOKEN` to authenticate the latest-release lookup (unauthenticated GitHub API requests are limited to 60 per hour); the lookup times out after 15 seconds.

## Agent compatibility

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) discovers `.github/skills/`, `.agents/skills/` and `.claude/skills/`. [VS Code Local sessions](https://code.visualstudio.com/docs/agent-customization/agent-skills#_skill-locations) also recognize these locations; supported locations can vary by harness. Pick the folders your harnesses need with `saveOptions`.
- [Claude Code](https://code.claude.com/docs/en/skills#choose-where-skills-load) discovers `.claude/skills/` and explicitly supports symlinked skill directories.
- `sf-` uses the documented lowercase/hyphen naming format; `sf_` does not. Each imported skill's frontmatter name matches its prefixed folder. Prefixed names longer than the 64-character skill name limit are trimmed to 64 characters (without a trailing hyphen); if two skills would end up with the same name, the import fails so you can ignore one of them.
- On Windows, the script creates directory junctions (no administrator rights or Developer Mode required). On other platforms it creates relative directory symlinks. Both expose the complete skill, including supporting resources, without duplicate copies. After moving the workspace on Windows, remove only the generated junctions that still point at its old location, then rerun the importer.
- Skills are available for relevant requests, not guaranteed to be selected automatically. Start a fresh session and check the skill slash-command menu; invoke `/sf-<upstream-name>` to verify loading. In Copilot CLI, you can also use `/skills reload` and `/skills info sf-<upstream-name>`.

## Validation

Run the importer's isolated integration and unit tests with:

```bash
node --test scripts/salesforce-skills/import-salesforce-skills.test.ts
```

## Intended audience

This script is intended for Salesforce administrators, developers, and operations teams who are familiar with the Salesforce data model and need to automate Salesforce development or admin tasks.

## Notes

- The script has mainly been generated by an LLM, but has been reviewed and read and edited by the maintainer. There could be some mistakes or room for improvement, so please review the code before running it.
- The code has only been tested using VS Code, so if you are using a different editor or IDE, there might be some adjustments needed to run the script successfully.
- Please raise Issues or PRs if you have suggestions for improvements or find any bugs!
