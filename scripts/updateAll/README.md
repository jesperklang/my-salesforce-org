# updateAll

Keeps the npm packages in this repo up to date and checks them for
vulnerabilities. It updates global npm packages, the repo's npm packages,
Multi-Framework Components (packages beneath `uiBundles` folders), and
Salesforce CLI plugins.

## Contents

- [Running the script](#running-the-script)
- [Progress checklist](#progress-checklist)
- [Package checks](#package-checks)
- [CI](#ci)
- [Development](#development)

## Running the script

The script is written in TypeScript as an ES module and runs directly with
Node.js 22.18 or newer. Run it from anywhere in the repo with npm:

| Command | What it does |
| --- | --- |
| `npm run updateAll` | Checks and updates everything. |
| `npm run updateAll:dry-run` | Runs every check, but makes no updates. |
| `npm run updateAll:ci` | For CI: skips global npm packages and Salesforce CLI plugins (see [CI](#ci)). |

Options can also be passed after `--`, for example `npm run updateAll:ci -- --dry-run`.
`npm run updateAll --dry-run` (without `--`) also works. Pass `-h` or `--help`
to print the usage summary. Unknown options stop the script with an error.

The script can also be run with Node directly from the repo root:

```bash
node scripts/updateAll/updateAll.ts [--dry-run] [--ci] [--output-dir=<folder>] [--allow-scripts=<packages>] [-h|--help]
```

`--output-dir` writes the run's results to files (see [Output files](#output-files)).
`--allow-scripts=<packages>` (or the `UPDATEALL_ALLOW_SCRIPTS` environment
variable) passes `--allow-scripts=<packages>` to global `npm update` if your
environment requires lifecycle scripts for specific global packages.

The script finds the Git project root from its own location, so the terminal's
working directory does not matter once Node has found the script file.

In Git Bash on Windows, `node` is an alias for `winpty node.exe`, but `npm run`
starts `node.exe` without `winpty`, so Node does not see a terminal and the live
progress view and colors would be off. When the script detects this (Windows,
Git Bash, no terminal, not in CI), it checks whether `winpty` can provide a
terminal and, if so, restarts itself through `winpty`. If `winpty` is missing or
cannot attach (for example when the output is redirected to a file), the script
continues without the live view.

A dry run runs every check and shows the real version tables without updating
anything. Read-only commands such as `npm outdated` and `npm ls` run normally;
`npm update`, `npm audit fix`, and `sf plugins update` are only shown as
`Would run: ...`.

The project root and each bundle also check every dependency in
`package-lock.json`, including indirect ones that the package table does not
list.

In a normal run, there is no separate check: when a `package-lock.json` exists,
`npm update --save` always runs. `--save` also updates the version ranges in
`package.json` for the packages it updates (for example `^9.39.4` →
`^9.39.5`); global packages are updated without it. The script records the lock
file and runs `npm audit`
before the update, then compares the lock file afterwards and shows the result
under `Update packages`. If nothing changed, the task is shown as
`[-] Update packages - skipped` (green) with `Nothing to update ✔`. Without a
`package-lock.json`, `npm update` runs only when the package table shows an
outdated package, so no lock file is created when nothing needs updating (if an
update does run, npm may create a `package-lock.json` unless disabled in
`.npmrc`).

In a dry run, a `Check dependencies` task copies `package.json`,
`package-lock.json`, and `.npmrc` (if present) to a temporary folder, runs
`npm update --save --package-lock-only` there, and compares the result with the
real lock file. The temporary folder is deleted afterwards. Folders without
`package-lock.json` skip this check.

Either way, only the counts that are not zero are shown (past tense in a normal
run, for example `Dependencies updated: 112` and `10 fixed high vulnerabilities`):

```text
Dependencies to update: 112
     10 fix high vulnerabilities
      2 fix moderate vulnerabilities
    100 other updates
Dependencies to add: 87
Dependencies to remove: 20
```

Updates are grouped by the severity of the vulnerability they fix (from
`npm audit` before and after the update); critical and high lines are red.
Removed dependencies are packages that nothing depends on anymore.

After the update (or right away if nothing needed updating), the script checks
for vulnerabilities. If there are any, even low ones, it runs `npm audit fix`
(never `--force`), shows `fixing vulnerabilities...` while it runs, and reports
the result by severity:

```text
  ! Vulnerabilities found: 27 (15 low, 2 moderate, 10 high)
    Fixed: 12 (2 moderate, 10 high)
  ! Not resolved: 15 (15 low)
```

`npm audit fix` can make things worse, for example by downgrading a peer
dependency to an old version with critical vulnerabilities. So before the real
fix, the script runs `npm audit fix --package-lock-only` on a copy of
`package.json`, `package-lock.json`, and `.npmrc` in a temporary folder. If that
would add a vulnerable package (or make a package's vulnerability more severe),
the real fix is skipped and the packages are listed:

```text
  ! Vulnerabilities found: 59 (2 low, 3 moderate, 54 high)
    ...
  ! Skipped, npm audit fix would add: 3 (1 moderate, 2 critical)
        @vitest/mocker (1 moderate)
        tinypool (1 critical)
        vitest (1 critical)
  ! Not resolved: 59 (2 low, 3 moderate, 54 high)
```

If the real fix still adds vulnerabilities, they are listed under
`Added by npm audit fix` in the same way.

Below `Vulnerabilities found`, each top-level package that contains vulnerable
packages is listed with its own counts, using the same colors. For the repo and
Multi-Framework Components these are the packages in `package.json`; for global
packages they are the installed global packages:

```text
  ! Vulnerabilities found: 42 (8 moderate, 31 high, 3 critical)
        @salesforce/cli (8 moderate, 24 high)
        @vscode/vsce (4 high)
        generator-code (3 high, 2 critical)
        npm (1 moderate, 2 high)
        yo (1 moderate, 5 high, 1 critical)
```

A vulnerable package is counted under every top-level package that depends on it
(following `npm audit`'s dependency chain, and for global packages also the
install path), so the counts of the listed packages can add up to more than the
total.

The `!` before `Vulnerabilities found` and `Not resolved` (or `Would not resolve`
in a dry run) is red and sits two columns to the left, so the text after it lines
up with the surrounding lines. The rest of these lines uses the terminal's default
text color, and each severity count uses the same color as `npm audit`: critical
is bold magenta, high bold red, moderate bold yellow, and low and info bold.

Only the totals by severity are shown in the progress checklist. If any
vulnerabilities remain after `npm audit fix`, or global
packages have vulnerabilities, a note with a red `!` is printed at the end of the
run, above the `*` note. In these notes, `npm audit` is blue:

```text
! Some vulnerabilities could not be fixed automatically. Run npm audit in the
  repo or Multi-Framework Component folder for details and how to fix them.
! Global packages have vulnerabilities that npm cannot fix. npm audit does not
  support global packages; update the affected global packages when fixes are released.
* Newer than your version range allows, so npm update skips it.
  See https://docs.npmjs.com/cli/commands/npm-update
```

Below the notes, a `Vulnerability links` list shows a link to every advisory
that is still present, grouped by global packages, the repo, and each
Multi-Framework Component (for the repo and components, the advisories left
after `npm audit fix`, or that would be left in a dry run). Within each group,
advisories are listed once, sorted by severity (colored like the counts above)
and package name. The list reuses the `npm audit` results the script already
collected, so no extra commands are run:

```text
Vulnerability links:
  Global npm packages:
    critical  locutus: Locutus vulnerable to RCE via unsanitized input in create_function()
              https://github.com/advisories/GHSA-vh9h-29pq-r5m8
    high      undici vulnerable to Denial of Service via TLS 1.2 certificate-changing renegotiation
              https://github.com/advisories/GHSA-qrxm-fqhp-jwvm
  Repo npm packages:
    low       deepmerge mergeObject() allows prototype poisoning of returned objects
              https://github.com/advisories/GHSA-gcqx-w48m-w2h4
  Multi-Framework Components > Standup:
    moderate  minimatch has potential denial of service via globparts amplification
              https://github.com/advisories/GHSA-g3hv-75wg-m249
```

With no
vulnerabilities, it shows `found 0 vulnerabilities`. `npm update` runs with
`--no-audit` so npm does not print a second summary, and `npm audit fix` output is
hidden unless it fails. Remaining vulnerabilities usually need a breaking upgrade
(`npm audit fix --force`), which the script never does. A dry run simulates
`npm audit fix` in the temporary folder and reports `Would fix` and
`Would not resolve` instead. Vulnerabilities do not fail the step.

`npm audit` does not support global packages, so the script builds a temporary
project for them instead. It walks the global `node_modules` folder (skipping
linked packages such as this repo), writes a `package.json` and a
`package-lock.json` with the exact installed versions to a temporary folder, and
runs `npm audit` there. The total is shown under the global
`Check for vulnerabilities` task, for example
`Vulnerabilities found: 42 (8 moderate, 31 high, 3 critical)`.
`npm audit fix` cannot change global packages, so these are fixed only when the
affected packages release updates that `npm update` can install.

The script finds the Git project root from its own location, regardless of the
terminal's working directory. It updates global npm packages, root-project
dependencies, Multi-Framework Components (packages
beneath every `uiBundles` directory, found with
`fs.globSync("**/uiBundles/**/package.json")`, excluding
`node_modules` and `.git`), and finally Salesforce CLI plugins. Bundle progress rows show only
the folder name, for example `[>] Standup - checking for updates...`.

## Progress checklist

Before any updates start, the script discovers all bundle packages and displays
the complete plan (without a title line). There are up to four main steps. Each
step, and each bundle under `Multi-Framework Components`, has an indented row
for every task it runs:

```text
[x] Global npm packages - done!
    [x] Check for outdated packages - done!
        Dependencies with updates: 0
        Package          Current  Wanted   Latest
        @salesforce/cli  2.155.8  2.155.8  2.155.8
    [-] Update packages - skipped
        Nothing to update ✔
    [x] Check for vulnerabilities - done!
        found 0 vulnerabilities
[>] Repo npm packages - updating...
    [x] Check for outdated packages - done!
    [>] Update packages - updating...
    [ ] Check for vulnerabilities - waiting
    [ ] Attempt fixing vulnerabilities - waiting
[ ] Multi-Framework Components - waiting
    [ ] Standup - waiting
        [ ] Check for outdated packages - waiting
        [ ] Update packages - waiting
        [ ] Check for vulnerabilities - waiting
        [ ] Attempt fixing vulnerabilities - waiting
[ ] Salesforce CLI plugins - waiting
    [ ] Check and update plugins - waiting
```

There are no blank lines between steps. Dry runs add a `Check dependencies` task
after `Check for outdated packages` for the repo and each Multi-Framework
Component.

Indicators are `[ ]` waiting (default text color), `[>]` running (blue), `[x]` complete
(green), `[!]` error (red), and `[-]` skipped (default text color; green for
`Update packages` when there was nothing to update). Normal text is never given
an explicit color, so it follows the terminal theme. Done means
successfully checked and updated if needed, not necessarily that package
versions changed. Dry-run steps say `preview done!`, not that updates were
performed.

The running phase of a step and its parent rows follows the active task:
`checking for updates...`, `checking dependencies...`, `updating...`,
`checking for vulnerabilities...`, or `fixing vulnerabilities...`. The
Salesforce CLI plugins tasks stay on `checking for updates...`, because
`sf plugins update` both checks and updates and whether anything changed is
only known afterwards. Dry runs show `previewing updates...` and
`previewing fixes...` instead of `updating...` and `fixing vulnerabilities...`.
Tables, messages, errors, and command output appear under the task that
produced them, and the `Up to date!`/`Updated!` status appears after the tasks.
`Update packages` shows `skipped` with `Nothing to update ✔` below it when nothing changes, and
`Attempt fixing vulnerabilities` shows `skipped - no need` when there are no vulnerabilities. If a
task fails, the remaining tasks of that step are marked `skipped`.

The Multi-Framework Components parent follows the phase of its active child. It
succeeds only if every child succeeds; failed bundles do not stop the remaining
bundles. If there are no bundles, the step is not shown at all. A
bundle-discovery error is reported on the Multi-Framework Components step
without preventing the other main steps from running.

In an interactive terminal, the plan is rendered inline in the normal terminal
(no alternate screen). The live area at the bottom contains every step that has
not finished yet, with the running task's details directly beneath its row.
Finished tasks of a step that is still running keep their details visible too
(for example the outdated packages table while the update runs), as long as they
fit in the terminal; the running task's details get space first.
Status changes replace the row in place. When a main step finishes, its row and
complete details are written once to normal terminal history, and the live area
continues below it. Bundle rows stay in the live area until the whole
Multi-Framework Components step finishes, then the parent and all bundles are
written with their details.

If the active task's details do not fit, the live area shows only the newest
lines (marked with `...`); the complete details are still written when the
step finishes. If the terminal is too short for every row, task rows are shown
only for the step that is running; step and bundle rows are never hidden, and
all task rows are written when the step finishes. Live rows are clipped to the
terminal width.

Very small terminals and `TERM=dumb` print the initial plan and then each step's
final row and details once it finishes. Redirected output (not a terminal) skips
the initial plan and only prints each finished step. If the terminal
becomes too small while running, the live area is removed and the same
behavior continues. Interrupting marks running steps as errors, writes the
remaining steps, and restores the cursor.

Colors are used in a terminal and in GitHub Actions, Azure Pipelines, and
GitLab CI. They are turned off when `NO_COLOR` is set or when output is
redirected anywhere else; `FORCE_COLOR=1` turns them back on.

Errors show `[!] ... - error` immediately. A failed check never starts its
update, but later main steps and bundle siblings still run. At the end, an
`Errors:` summary lists each failed step, its message, and available command
error output. Errors include the full path, for example
`Multi-Framework Components > Standup > Update packages`. The script exits with a
nonzero status if any step failed.
Fatal setup errors, such as an unavailable project root, show a script-level
error and stop rather than running updates in an unintended directory.

## Package checks

For global packages, npm updates are skipped when Current equals Wanted, even
when Latest is newer. For the project root and bundles, `npm update` runs when
Current differs from Wanted or when the dependency check would change
`package-lock.json`.
All dependency checks print `Dependencies with updates: <count>` (with `(<count> newer outside range)` when any packages have a newer version outside the allowed range) and share the same package table. Only the Current column is
colored: green when Current equals Wanted, or yellow when they differ. The table
header is blue. Package, Wanted, and Latest are uncolored; Latest is
marked with a blue `*` when it differs from Wanted (a newer version outside the
allowed version range); if any table had a marked Latest, a short note with a
blue `*`, linking to the
[npm update documentation](https://docs.npmjs.com/cli/commands/npm-update) is
printed after the script finishes. Empty tables are
omitted; the following update status reports whether an update is needed.
Step 1 combines checking and updating global npm packages, listing all installed
packages. Global packages have no version range, so packages not reported by
`npm outdated --global` are already at Latest and are not looked up in the
registry; for them, Wanted and Latest equal Current. Local, linked, or private
packages show `Local` in Latest.
Step 2 (`Repo npm packages`) combines checking and updating the npm packages in
the repo's root `package.json`.
Packages that `npm outdated` reports without a Current version are not installed
and show `MISSING`. Errors are
reported, affected updates are skipped, and the script exits with a nonzero
status if any operation fails.
Error output from commands is red.

For the npm steps, the result is shown under the `Update packages` task (text
followed by a green check mark): `Nothing to update ✔` when the task was
skipped, or `Up to date! ✔` after a successful update (not in dry runs). The
Salesforce CLI plugins step shows `Up to date! ✔` or `Updated! ✔` under its
`Check and update plugins` task (not in dry runs).

After `npm update`, the `Update packages` task lists the packages from the table
whose installed version changed (read with `npm ls --depth=0`), with the previous
version in yellow and the new version in green, followed by npm's own summary line:

```text
[x] Update packages - done!
    Updated packages:
        @vscode/vsce 4.0.0 → 4.1.0
    Changed 1557 packages in 3m.
    Up to date! ✔
```

Dry runs show `Would update packages:` with Current → Wanted instead. If only
indirect dependencies change, the list is omitted.
For Salesforce plugin
updates, the script launches the globally npm-installed CLI entry point with
Node when available, so missing `sf` command shims do not prevent execution.
The entry point is resolved once per run. Standalone CLI installations are
resolved through PATH when no global npm installation is present.

The last step, `Salesforce CLI plugins`, has one task, `Check and update plugins`.
It first checks that the Salesforce CLI is installed (a global npm installation,
or `sf --version` succeeding through PATH). If it is not, the task shows
`skipped - Salesforce CLI is not installed` and the step says so instead of
failing. Otherwise it records every plugin's
version with `sf plugins --json`, runs `sf plugins update`, and lists the
versions again. Only plugins whose version changed are listed the same way as
updated npm packages (previous version in yellow, new version in green), followed by `Updated! ✔`:

```text
[x] Check and update plugins - done!
    Updated plugins:
        sfdmu 5.8.0 → 5.9.0
    Updated! ✔
```

If no version
changed, it prints `Up to date! ✔`. The output of
`sf plugins update` itself is hidden unless the command fails. The CLI handles
source-based, pinned, and migrating user plugins itself. Bundled core plugins are
updated with the Salesforce CLI in step 1; linked development plugins are not
updated. Dry runs only show `Would run: sf plugins update`, because which
plugins would change is only known after the update.

## CI

The script works in any CI. Run `npm run updateAll:ci` (the script with `--ci`).
It skips the global npm packages and Salesforce CLI plugins steps entirely (they
are not shown in the plan either), so only the repo and Multi-Framework Component
packages are checked and updated:

```bash
npm run updateAll:ci -- --output-dir=updateAll-output
```

The exit code is nonzero if any step failed.

### Outputs

When the script finishes, it reports these values:

| Output | Value |
| --- | --- |
| `packages-changed` | `true` if any `package.json` or `package-lock.json` in the repo root or a Multi-Framework Component folder changed during the run, otherwise `false`. Dry runs always report `false`. |
| `worst-severity-found` | The highest vulnerability severity found by any `Check for vulnerabilities` task (after updates). |
| `worst-severity-unresolved` | The highest severity still left after `Attempt fixing vulnerabilities`. Global vulnerabilities always count as unresolved. |
| `summary` | The full output of the run as Markdown, for example for a pull request description. |

Severities are numbers, so they can be compared:

| Number | Severity |
| --- | --- |
| `0` | No vulnerabilities |
| `1` | info |
| `2` | low |
| `3` | moderate |
| `4` | high |
| `5` | critical |

The `summary` Markdown has no title, so it can be used as is. It has a section
for each step, with the status of each task
(✅ done, ❌ error, ⏭️ skipped). Package tables are Markdown tables, lists such as
the vulnerable packages and updated packages are bullet lists, and raw command
output is in code blocks. After the steps come any errors, the end-of-run notes,
and a `Vulnerability links` table for each group (severity, package, and a link
to the advisory). Text from npm is escaped so it cannot change the formatting.

Markdown has no text colors, so the summary uses the terminal's colors (except
blue and the status text, which are left uncolored) through LaTeX math, for example
`$\color{red}{\textsf{10 high}}$`. GitHub, GitLab,
and Azure DevOps render it as colored text; renderers without math support (for
example Bitbucket) show the LaTeX source. Yellow (moderate, outdated Current
versions, and previous versions) is shown in `goldenrod` instead so it is readable on light backgrounds, and low and info are
bold. Only text made of letters, digits, spaces, and `.,:!()+-` is colored;
anything else is shown uncolored. Check the provider's size limit if you use
the summary as a pull request description, for example 65,536 characters on
GitHub and 4,000 on Azure DevOps.

#### Output files

With `--output-dir=<folder>`, the outputs are written to files in that folder.
This works in any CI. The folder is created if needed, and a relative path is
resolved from the current working directory:

| File | Content |
| --- | --- |
| `summary.md` | The `summary` Markdown. |
| `outputs.env` | The other outputs as `KEY=value` lines: `UPDATEALL_PACKAGES_CHANGED`, `UPDATEALL_WORST_SEVERITY_FOUND`, and `UPDATEALL_WORST_SEVERITY_UNRESOLVED`. |

`outputs.env` can be loaded in a shell (`. updateAll-output/outputs.env`), used
as a GitLab [dotenv report](https://docs.gitlab.com/ci/yaml/artifacts_reports/#artifactsreportsdotenv),
or read with Jenkins' `readProperties`. For example, in any CI with Bash:

```bash
npm run updateAll:ci -- --output-dir=updateAll-output
. updateAll-output/outputs.env
if [ "$UPDATEALL_PACKAGES_CHANGED" = "true" ]; then
    # Create the pull request with your provider's CLI, for example:
    # glab mr create --title "Update npm packages" --description "$(cat updateAll-output/summary.md)"
    echo "Packages changed"
fi
if [ "$UPDATEALL_WORST_SEVERITY_UNRESOLVED" -ge 4 ]; then
    echo "High or critical vulnerabilities could not be fixed automatically."
    exit 1
fi
```

#### GitHub step outputs

In GitHub Actions, when `GITHUB_OUTPUT` is set, the outputs are also written as
step outputs with the names above (`summary` is a multiline output). Nothing
extra is needed for this; `--output-dir` can still be used as well.

### CI logs

The script detects GitHub Actions (`GITHUB_ACTIONS=true`), Azure Pipelines
(`TF_BUILD=True`), and GitLab CI (`GITLAB_CI=true`). In these, each finished step
is written as a collapsible log section (`::group::` in GitHub, `##[group]` in
Azure, and `section_start`/`section_end` in GitLab). In GitHub and Azure, the
end-of-run `!` notes become warnings (`::warning::` and
`##vso[task.logissue type=warning]`) and failed steps become errors, so they show
up in the run summary. GitLab has no annotations, so the notes are printed as
usual. In any other CI, the log is plain text, as when the output is redirected
to a file.

### Example GitHub Actions workflow

This workflow runs every Monday (and manually), opens a pull request with the
full run as its description when the package files changed, warns about moderate
vulnerabilities that remain, and fails when high or critical vulnerabilities
could not be fixed. Save it as `.github/workflows/update-npm-packages.yml`.

```yaml
name: Update npm packages

on:
  schedule:
    - cron: "0 5 * * 1"
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  update:
    runs-on: ubuntu-latest
    env:
      HUSKY: "0"
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: |
            package-lock.json
            force-app/**/uiBundles/**/package-lock.json

      - name: Install packages
        run: npm ci

      - name: Update packages
        id: update
        run: npm run updateAll:ci

      - name: Create pull request
        if: steps.update.outputs.packages-changed == 'true'
        uses: peter-evans/create-pull-request@v7
        with:
          branch: chore/npm-updates
          title: Update npm packages
          commit-message: Update npm packages
          body: ${{ steps.update.outputs.summary }}
          add-paths: |
            **/package.json
            **/package-lock.json

      - name: Warn about moderate vulnerabilities
        if: steps.update.outputs.worst-severity-unresolved == '3'
        run: echo "::warning::Moderate vulnerabilities remain. Run npm audit for details."

      - name: Fail on high or critical vulnerabilities
        if: fromJSON(steps.update.outputs.worst-severity-unresolved) >= 4
        run: |
          echo "::error::High or critical vulnerabilities could not be fixed automatically. Run npm audit for details."
          exit 1
```

`HUSKY: "0"` skips setting up Git hooks during `npm ci`, and `cache: npm` reuses
npm's download cache between runs. If the script itself fails, the following
steps are skipped; add `if: always() && ...` to a step that should still run.

## Development

On Windows, npm and `sf` are started through `cmd.exe` with
`NoDefaultCurrentDirectoryInExePath` set, so an `npm.cmd` or `sf.cmd` inside the
project or a bundle folder cannot replace the real command.

The implementation is split between the CLI entry point (`updateAll.ts`) and
focused modules under `lib/` (`types.ts`, `format.ts`, `progress.ts`,
`runner.ts`, `audit.ts`, `npm.ts`, and `sf.ts`).

The `tsconfig.json` in this folder configures Node.js ES modules and types for
editor support and type checking (`npm run typecheck:updateAll` or
`npx tsc -p scripts/updateAll/tsconfig.json`).
It does not generate JavaScript files and is not needed to run the script.
`@types/node` is a dev dependency; `typescript` is currently installed through
other packages (for example ESLint plugins).

Run the tests with `npm run test:updateAll` (or
`node --test scripts/updateAll/updateAll.test.ts`).
