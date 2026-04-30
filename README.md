# My Salesforce Org

This repository contains Salesforce components, scripts, and reusable solutions that I have built for my everyday developer org, that I want to share with others that find them useful.

More solutions will be added over time.

## Included Solutions

### [Scrollable Field](force-app/scrollable-field)

Scrollable Field is a LWC for Salesforce record pages. It displays one selected field from the current record inside a fixed-height Lightning card with its own scroll area. Works on any Object's record page.

This is useful for fields that can contain a lot of content, such as long text areas, rich text fields or other fields that would otherwise take up too much space on a record page. Instead of letting a single field stretch the page, the component keeps the layout compact while still making the full field value available to the user.