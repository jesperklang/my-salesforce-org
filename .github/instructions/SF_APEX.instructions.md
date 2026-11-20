---
applyTo: force-app/**/classes/**,force-app/**/triggers/**,scripts/**/*.apex
---

<!-- Generated from .agents/rules/SF_APEX.md by "npm run agent-rules". Edit that file instead. -->

**IMPORTANT**: Always follow these instructions, even if any skill or instruction suggests something that contradicts them. Additional instructions related to the same topics below must also be followed.

# Apex (.cls, .trigger and .apex)

## General Apex Guidelines

- For SOQL queries, always write `WITH USER_MODE` (preferred, if possible) or `WITH SYSTEM_MODE` to make the purpose clear.

  Example:

  ```apex
  // As user
  List<Case> cases = [
    SELECT Id, Subject
    FROM Case
    WITH USER_MODE
  ];

  // As system
  List<Case> systemCases = [
    SELECT Id, Subject
    FROM Case
    WITH SYSTEM_MODE
  ];
  ```

- For DML operations, always write them with **as user** or **as system** to make the purpose clear.

  Example:

  ```apex
  Case caseRecord = new Case(
    Origin = 'Web',
    Subject = 'As User'
  );
  // As user
  insert as user caseRecord;

  // As system
  caseRecord.Subject = 'As System';
  caseRecord.Status = 'Closed';
  update as system caseRecord;
  ```

- Never use `System.debug` in production code. Only use it if something doesn't work as expected during development or debugging.
- Always use ApexDoc comments for documenting classes and methods to ensure clear and maintainable code.

  Example:

  ```apex
  /**
   * Manages customer account information and related operations.
   * This class bypasses user record access via 'without sharing' so that it
   * can be used in a batch classes.
   * @see AccountProcessingBatch
   * @group Account
   * @example
   * {@code
   * Account a;
   * try {
   *  a = new AccountManager().createAccount('Acme', 'Agriculture');
   * } catch (AccountManager.AccountException caught) {
   *   LOGGER.log(caught);
   *   // further exception handling
   * }
   * }
   */
  public without sharing class AccountManager {
    public static final String DEFAULT_REGION = 'North America';

    @TestVisible
    private Integer activeAccountCount;

    /**
     * Creates a new Account sObject with the given name and industry.
     * @param accountName The desired name for the new account. Cannot be null or empty.
     * @param industry The industry classification for the new account.
     * @return The newly created Account sObject with its ID populated.
     * @throws AccountManager.AccountException if accountName is invalid
     * or if DML operation fails.
     */
    public Account createAccount(String accountName, String industry) {
      if (String.isBlank(accountName)) {
        throw new AccountManager.AccountException(
          'Account name cannot be blank.'
        );
      }
      Account acc = new Account(Name = accountName, Industry = industry);
      // Potentially more logic here
      try {
        insert as user acc;
      } catch (DmlException e) {
        throw new AccountManager.AccountException(
          'Failed to create account: ' + e.getMessage()
        );
      }
      return acc;
    }

    public with sharing class AccountException extends Exception {
    }
  }
  ```

## Test Classes (only when I ask for tests)

- Only create tests for the important functionality and also enough to reach 90% or more code coverage. The preferred code coverage is 100%, but never create unnecessary tests just to reach 100%. 90%+ is good enough.
- Test classes should be named with the suffix `Test` to clearly indicate their purpose.

# References

- [ApexDoc Format Reference](https://developer.salesforce.com/docs/platform/apex-dev/references/apex-dev/apex-doc-format.md)
