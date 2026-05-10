# My Salesforce Org

This repository contains Salesforce components, scripts, and reusable solutions that I have built for my everyday developer org, that I want to share with others that find them useful.

More solutions will be added over time.

## Included Solutions

### - [Scrollable Field](force-app/scrollable-field)

Scrollable Field is a LWC for Salesforce record pages. It displays one selected field from the current record inside a fixed-height Lightning card with its own scroll area. Works on any Object's record page.

This is useful for fields that can contain a lot of content, such as long text areas, rich text fields or other fields that would otherwise take up too much space on a record page. Instead of letting a single field stretch the page, the component keeps the layout compact while still making the full field value available to the user.

### - Code Editor Configuration

#### 1. [Spelling Dictionaries](spell-checker-dictionaries)

This folder contains custom dictionaries for the Code Spell Checker extension in VS Code, which I use for spell checking my code and comments. The dictionaries include Salesforce-specific terms, general development terms, and company-specific terms that you can specify for your Company.

#### 2. [Salesforce MCP Editor Configuration Sync](scripts/salesforce-mcp)

This folder contains a script that keeps local editor MCP settings in sync with Salesforce's MCP server configuration, and lets you use the MCP with the LLM of your choice. It updates the Salesforce MCP package, applies your tool and telemetry preferences, and writes the matching configuration for supported editors.

#### 3. [Salesforce Skills Script](scripts/salesforce-skills)

A script that imports Salesforce skills from the official Agentforce Vibes skill library into your workspace, letting you use these skills with the LLM of your choice. It helps keep reusable Salesforce guidance available to other LLMs while respecting the ignored skills configured for this project.

#### 4. More to come...
