# Scrollable Field

Displays a selected field from the current record in a fixed-height, scrollable Lightning card. This is especially useful for long text, rich text, notes, or other fields that can take up too much space on a record page.

![Component image](../../.assets/scrollable-field.png)

## Component Parameters

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| Field API Name | String | Yes | - | API name of the field to display from the current record, for example `Description` or `Type__c`. |
| Height (px) | Integer | Yes | `240` | Fixed component height in pixels. Content scrolls inside this height. Allowed range is `80` to `1200`. |
| Icon Name | String | No | `standard:note` | Salesforce Lightning Design System icon name shown in the card header, for example `standard:account` or `utility:edit`. |