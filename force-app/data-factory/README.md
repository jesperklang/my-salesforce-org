# Data Factory - Beta!

`DataFactory.create` returns an independent in-memory copy of any SObject, applying base defaults and an optional named flavour. It does not query or save records, and does not modify the input.

`DataFactory` is a regular public Apex class, so the same single-record and list overloads can be called from production code or `@isTest` classes. Test setup remains responsible for inserting records, providing required relationships, and satisfying validation rules.

Values take precedence in this order: **base defaults < flavour values < explicitly supplied fields**. Explicit nulls also override defaults. Existing IDs and loaded relationships are preserved.

## Apex Usage

```java
Account defaultAccount = (Account) DataFactory.create(new Account());
Account prospect = (Account) DataFactory.create(
  new Account(
    Name = 'Test Account',
    Type = 'Prospect'),
  'Customer'
);
Account customer = (Account) DataFactory.create(new Account(), 'Customer');
Account partner = (Account) DataFactory.create(new Account(), 'Partner');
Case caseRecord = (Case) DataFactory.create(new Case());
```

Each object's defaults and flavours are configured in [DataFactoryConfig](apex/DataFactoryConfig.cls):

```java
Account.SObjectType => new DataFactory.ObjectConfig()
  .withDefaults(new Map<Schema.SObjectField, Object>{
    Account.Name => 'Default Account {0}',
    Account.Type => 'Prospect',
    Account.Industry => 'Technology'
  })
  .withFlavour('Customer', new Map<Schema.SObjectField, Object>{
    Account.Type => 'Customer - Direct',
    Account.Ownership => 'Private'
  })
```

Use field tokens such as `Account.Name` and values of the corresponding Apex field type. Picklist values must be available in your org if you later insert the records. Flavour names are trimmed, case-insensitive when matching, and preserve their configured casing for LWC and Flow display. An object without configuration is copied unchanged. Null or blank flavour names apply only base defaults; unknown flavours raise `DataFactoryException`.

The same overloads accept `List<SObject>` and return copies in input order, or accept an `SObjectType` and `count` to generate multiple records directly. When a flavour is supplied for a mixed-object list, it must be configured for every object's type.

```java
List<SObject> customers = DataFactory.create(
  new List<SObject>{
    new Account(Name = 'First Account'),
    new Account(Name = 'Second Account')
  },
  'Customer'
);
List<SObject> bulkCustomers = DataFactory.create(
  Account.SObjectType,
  5,
  'Customer'
);
List<SObject> mixedRecords = DataFactory.create(
  new List<SObject>{ new Account(), new Case() }
);
```

### Numbered values

Use `{0}` anywhere in a string default, flavour value, or caller-supplied field value, such as `Account.Name => 'Default Account {0}'` or `new Account(Name = 'Hello {0}')`. Every occurrence is replaced with the record's sequence number, starting at **1 per SObject type per Apex transaction**. Further `create` calls continue that object's sequence; different objects have independent counters. A new transaction starts again at 1, so this is not a globally unique identifier.

```java
List<SObject> accounts = DataFactory.create(Account.SObjectType, 2);
// Names: Default Account 1, Default Account 2
Account nextAccount = (Account) DataFactory.create(new Account());
// Name: Default Account 3
Account customAccount = (Account) DataFactory.create(
  new Account(Name = 'Hello {0}')
);
// Name: Hello 4
```

Every built record advances its object's counter, even if its configuration or caller values have no placeholders. Empty calls do not advance counters. Plain strings, non-string values, and explicit nulls remain unchanged.

Configuration getters such as `getBaseDefaults`, `getConfiguredValues`, and the LWC `getFlavourDefaults` return the original templates without consuming numbers. Substitution happens when `DataFactory.create` builds the record, including when a template is passed back as an explicit field value.

## LWC Usage

Lightning Web Components can use four `@AuraEnabled` methods on [DataFactoryController](apex/lwc-classes/DataFactoryController.cls), limited to the objects configured in [DataFactoryConfig](apex/DataFactoryConfig.cls):

- `getObjectFlavours()` (cacheable) returns `{ objectApiName, label, flavours }` for every configured object, sorted by label.
- `getFlavours({ objectApiName })` (cacheable) returns the flavour names of one object.
- `getFlavourDefaults({ objectApiName })` (cacheable) returns `{ flavour, fieldValues }` for the base defaults (`flavour` is null) followed by each flavour, with the flavour values merged over the defaults.
- `createRecord({ objectApiName, fieldValues, flavour })` returns an **unsaved** record with defaults, flavour, and `fieldValues` applied. Saving it is up to the component.

```javascript
import getObjectFlavours from "@salesforce/apex/DataFactoryController.getObjectFlavours";
import getFlavours from "@salesforce/apex/DataFactoryController.getFlavours";
import createRecord from "@salesforce/apex/DataFactoryController.createRecord";

const objects = await getObjectFlavours();
const accountFlavours = await getFlavours({ objectApiName: "Account" });
const account = await createRecord({
  objectApiName: "Account",
  fieldValues: { Name: "Acme" },
  flavour: "Customer",
});
```

Field names in `fieldValues` are case-insensitive and validated against the object; values are converted to the field types (for example ISO date strings). Unconfigured objects, unknown flavours, and invalid fields or values raise an `AuraHandledException` with a descriptive message.

For convenience, the headless [dataFactoryHelper](lwc/dataFactoryHelper) LWC wraps these methods with plain arguments and rejects with a regular `Error` carrying the Apex message. Its `insertRecord` builds the record with `DataFactory` and saves it with a GraphQL mutation, resolving with the saved record (`Id` plus `{ value, displayValue }` per field):

```javascript
import {
  getObjectFlavours,
  getFlavours,
  getFlavourDefaults,
  createRecord,
  insertRecord,
} from "c/dataFactoryHelper";

const objects = await getObjectFlavours();
const accountFlavours = await getFlavours("Account");
const account = await createRecord("Account", { Name: "Acme" }, "Customer");
const savedAccount = await insertRecord(
  "Account",
  { Name: "Acme" },
  "Customer",
);
```

## Flow Usage

Flows can use three invocable actions in the **Data Factory** category:

- **Get Data Factory Objects** (`DataFactoryFlowObjects`): returns an Apex-defined collection of `DataFactoryFlowObjectOption` records (`label`, `objectApiName`) for every object configured in `DataFactory`. Bind this collection to a Flow **Collection Choice Set** to let users pick an object dynamically.
- **Get Data Factory Flavours** (`DataFactoryFlowFlavours`): takes an **Object API Name** and returns an Apex-defined collection of `DataFactoryFlowFlavourOption` records (`label`, `value`, `flavour`). Bind this collection to a Flow **Collection Choice Set** so users can pick a flavour without hardcoding choices in the Flow.
- **Build Record with Data Factory** (`DataFactoryFlowCreate`): takes a required **Flavour** (`[Object]: [Flavour]`, such as `Account: Default` or `Account: Customer`, or the value selected from the Collection Choice Set) and an optional **Input Record** whose set values win over the defaults and flavour. Returns the unsaved **Output Record** (save it with a Create Records element) and an **Overrides Summary** listing any base default fields overridden by the selected flavour.

## Examples

Two examples let you pick a configured Object and Flavour dynamically, edit the prefilled fields, and review the saved values:

- [dataFactoryExample](lwc/dataFactoryExample) LWC, which loads configured objects and flavour names dynamically, saves with `insertRecord`, and shows the result in a modal.
- [Data Factory Example](flows/DataFactoryExample.flow-meta.xml) Screen Flow, which loads configured objects via **Get Data Factory Objects** and flavours via **Get Data Factory Flavours** into Collection Choice Sets, then builds the record with **Build Record with Data Factory**.

## Testing

Apex behaviour is tested by `DataFactoryTest`, `DataFactoryControllerTest`, `DataFactoryFlowCreateTest`, `DataFactoryFlowFlavourPicklistTest`, `DataFactoryFlowFlavoursTest`, and `DataFactoryFlowObjectsTest`. All Apex tests install a self-contained test configuration via `DataFactoryTest.useTestConfig()`, so changing production objects, flavours, or default field values in `DataFactory` does not require updating tests. The Jest tests mock Apex and GraphQL and only cover the LWCs themselves.

## Agent Skill

The [apex-data-factory](../../.agents/skills/apex-data-factory/SKILL.md) agent skill instructs coding agents to use `DataFactory` as the base when creating SObject records in Apex (production code, tests, and anonymous scripts). It covers the `DataFactory.create` overloads, `{0}` numbering, extending [DataFactoryConfig](apex/DataFactoryConfig.cls), and common Apex pitfalls such as avoiding direct `(List<Account>)` casts on `List<SObject>` results.
