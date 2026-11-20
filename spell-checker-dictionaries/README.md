## Spell-checker dictionaries

These directories require the extension [Code Spell Checker](https://marketplace.visualstudio.com/items?itemName=streetsidesoftware.code-spell-checker) to be installed in your code editor (e.g., Visual Studio Code) to work.

This directory contains custom dictionary entries used to support spell checking for this workspace, especially project-specific Salesforce terms, acronyms, and other names that are not part of a standard dictionary.

The [`cspell.json`](../cspell.json) file in root configures the spell checker and points it to the dictionaries and settings used by the project.

### Duplicate warnings

The **Watch dictionary duplicates** VS Code task checks every `.txt` file directly in this directory when it starts and whenever files are saved, added, or removed. Duplicate entries appear as warnings in the Problems panel, with the duplicate's location and the first occurrence's line number. Warnings clear after the duplicate is removed and the file is saved.

Checks are case-insensitive, ignore surrounding whitespace, blank lines, and `#` comment lines, and treat each dictionary separately. The same word in different dictionaries is allowed.

The task starts automatically when the workspace is opened, because `task.allowAutomaticTasks` is set to `on` in [`.vscode/settings.json`](../.vscode/settings.json) (automatic tasks never run in an untrusted workspace). To start it manually, run **Tasks: Run Task** from the Command Palette and select **Watch dictionary duplicates**. The task uses Node.js's built-in watch mode and requires Node.js 22.18 or newer; no third-party packages are used.

For a one-time check:

```bash
npm run check:dictionaries
```

The one-time check exits with code `1` if duplicates are found, or `0` if all dictionaries are unique. The scripts are configured in [`package.json`](../package.json), and the Problems panel integration is configured in [`.vscode/tasks.json`](../.vscode/tasks.json).
