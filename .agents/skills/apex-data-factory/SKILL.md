---
name: apex-data-factory
description: Use the repository's DataFactory class as the base for creating SObject records in Apex (production code, Apex tests, and anonymous Apex scripts). TRIGGER whenever creating or instantiating Salesforce SObject records in Apex, building test data, adding object defaults/flavours in DataFactoryConfig, or generating numbered/bulk records with {0} placeholders.
---

# Apex DataFactory

Use `DataFactory` (`force-app/data-factory/apex/DataFactory.cls`) as the standard base for instantiating SObject records in Apex — including production services, `@isTest` classes, and anonymous Apex scripts.

## Workflow

1. **Check existing configuration first**: Read `force-app/data-factory/apex/DataFactoryConfig.cls` to see which SObjects, base defaults, and named flavours already exist.
2. **Build records via `DataFactory.create(...)`**: Supply only the fields that matter for the specific scenario; let base defaults and flavours populate the rest.
3. **Extend `DataFactoryConfig.cls` when needed**: If an SObject or reusable variant is missing and will be used across tests or features, add its `ObjectConfig` / flavour in `DataFactoryConfig.cls` rather than duplicating field assignments at every call site.
4. **Perform DML explicitly**: `DataFactory.create(...)` is **in-memory only** — it never queries or saves records and never mutates the input. Always insert/update explicitly with `as user` or `as system` per `.agents/rules/SF_APEX.md`.

## API Reference

All `create` overloads return independent clones with defaults and optional flavour applied.

| Overload                                                                           | Use Case                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `DataFactory.create(SObject record)`                                               | Single record with base defaults                               |
| `DataFactory.create(SObject record, String flavour)`                               | Single record with base defaults + flavour                     |
| `DataFactory.create(List<SObject> records)`                                        | Multiple records (may be mixed types) with base defaults       |
| `DataFactory.create(List<SObject> records, String flavour)`                        | Multiple records with a flavour defined on every record's type |
| `DataFactory.create(Schema.SObjectType objectType, Integer count)`                 | `count` new records of one type with base defaults             |
| `DataFactory.create(Schema.SObjectType objectType, Integer count, String flavour)` | `count` new records of one type with base defaults + flavour   |

Read-only introspection helpers (do **not** advance sequence counters or substitute `{0}`):

- `DataFactory.getConfiguredTypes()`
- `DataFactory.getConfiguredType(String objectApiName)`
- `DataFactory.getFlavourNames(Schema.SObjectType objectType)`
- `DataFactory.getBaseDefaults(Schema.SObjectType objectType)`
- `DataFactory.getFlavourValues(Schema.SObjectType objectType, String flavourName)`
- `DataFactory.getConfiguredValues(Schema.SObjectType objectType, String flavourName)`

## Precedence & Semantics

- **Precedence**: `base defaults < flavour values < caller-supplied fields`.
- **Explicit nulls win**: `new Account(Type = null)` keeps `Type = null` instead of applying the default.
- **Immutability**: The input `SObject` is never modified; existing `Id`s and populated relationships are preserved on the returned clone.
- **Flavour matching**: Trimmed and case-insensitive. `null` or blank applies base defaults only. Unknown flavours throw `DataFactory.DataFactoryException`.
- **Unconfigured objects**: Returned as an independent clone unchanged (caller-supplied `{0}` placeholders are still substituted).

## Numbered Values (`{0}`)

Use `{0}` in any string default, flavour value, or caller-supplied string field. Every occurrence is replaced with a **transaction-wide, per-object sequence starting at `1`**.

- Subsequent `create` calls in the same Apex transaction continue that object's counter.
- Different SObject types maintain independent counters.
- Every built record advances its object's counter; empty calls (`count = 0` or empty list) do not.
- Plain strings, non-string values, and explicit nulls are left unchanged.
- Counters reset in new transactions (not a globally unique identifier).

## Usage Examples

### Single record with overrides or flavour

```apex
Account defaultAccount = (Account) DataFactory.create(new Account());

Account customer = (Account) DataFactory.create(
  new Account(Name = 'Acme {0}'),
  'Customer'
);

insert as user new List<Account>{ defaultAccount, customer };
```

### Bulk records

```apex
List<SObject> accounts = DataFactory.create(
  Account.SObjectType,
  5,
  'Customer'
);
insert as user accounts;
```

### Multiple records with custom templates

```apex
List<SObject> accounts = DataFactory.create(
  new List<SObject>{
    new Account(Name = 'Region North {0}'),
    new Account(Name = 'Region South {0}')
  },
  'Partner'
);
insert as user accounts;
```

### Typing a returned `List<SObject>`

`DataFactory.create(...)` list overloads instantiate `new List<SObject>()`. In Apex, **do not** cast the list directly with `(List<Account>)` — that throws `System.TypeException` at runtime.

```apex
// Good: insert directly as List<SObject>
List<SObject> created = DataFactory.create(Account.SObjectType, 3);
insert as user created;

// Good: cast individual elements when typed access is needed
Account firstAccount = (Account) created[0];
```

## Adding Objects or Flavours in `DataFactoryConfig`

Add object definitions in `force-app/data-factory/apex/DataFactoryConfig.cls` — do not hardcode object configs in `DataFactory.cls`.

```apex
private static DataFactory.ObjectConfig contactConfig() {
  return new DataFactory.ObjectConfig()
    .withDefaults(
      new Map<Schema.SObjectField, Object>{
        Contact.FirstName => 'Default',
        Contact.LastName => 'Contact {0}'
      }
    )
    .withFlavour(
      'DecisionMaker',
      new Map<Schema.SObjectField, Object>{
        Contact.Title => 'VP of Operations'
      }
    );
}
```

Rules for `DataFactoryConfig.cls`:

- Register the new method in `getConfig()` keyed by `SObjectType`.
- Always use `Schema.SObjectField` tokens (e.g. `Contact.LastName`), never string field names.
- Use `getRecordTypeId(SObjectType, developerName)` for Record Types — never hardcode Record Type IDs.
- Flavour names must not be blank, must not contain `': '` (`DataFactory.FLOW_FLAVOUR_SEPARATOR`), and must not be `'Default'` (`DataFactory.FLOW_DEFAULT_FLAVOUR`).

## Apex Test Guidance

- Use `DataFactory.create(...)` in `@TestSetup` and test methods to build records, then persist them with `insert as user` (or `insert as system` when testing system-context behaviour).
- Do **not** call `DataFactoryTest.useTestConfig()` outside the DataFactory unit tests — feature and domain tests should use the org's `DataFactoryConfig`.
- Keep tests responsible for required parent lookups (e.g. `Contact.AccountId`) and org-specific validation rules.
