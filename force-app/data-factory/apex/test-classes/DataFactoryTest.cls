@isTest
public class DataFactoryTest {
  private static final Integer BULK_RECORD_COUNT = 251;

  /**
   * Installs a self-contained test configuration so tests stay independent of
   * frequent changes to DataFactory's production object and flavour definitions.
   */
  public static void useTestConfig() {
    DataFactory.configByType = new Map<Schema.SObjectType, DataFactory.ObjectConfig>{
      Account.SObjectType => new DataFactory.ObjectConfig()
        .withDefaults(
          new Map<Schema.SObjectField, Object>{
            Account.Name => 'Test Default Account',
            Account.Type => 'Test Base Type',
            Account.Industry => 'Test Base Industry'
          }
        )
        .withFlavour(
          'FLAVOUR_A',
          new Map<Schema.SObjectField, Object>{
            Account.Type => 'Test Flavour A Type',
            Account.Ownership => 'Test Flavour A Ownership'
          }
        )
        .withFlavour(
          'FLAVOUR_B',
          new Map<Schema.SObjectField, Object>{
            Account.Type => 'Test Flavour B Type'
          }
        ),
      Case.SObjectType => new DataFactory.ObjectConfig()
        .withDefaults(
          new Map<Schema.SObjectField, Object>{
            Case.Subject => 'Test Default Case',
            Case.Status => 'Test Default Status'
          }
        )
    };
  }

  @isTest
  static void shouldLoadDefaultConfig_WhenNoTestConfigIsInstalled() {
    DataFactory.configByType = null;

    Test.startTest();
    Set<Schema.SObjectType> configuredTypes = DataFactory.getConfiguredTypes();
    Test.stopTest();

    Assert.isFalse(
      configuredTypes.isEmpty(),
      'DataFactoryConfig should provide at least one configured object.'
    );
  }

  @isTest
  static void shouldApplyDefaults_WhenNoValuesSupplied() {
    useTestConfig();

    Test.startTest();
    Account result = (Account) DataFactory.create(new Account());
    Test.stopTest();

    Assert.areEqual(
      'Test Default Account',
      result.Name,
      'Name should default.'
    );
    Assert.areEqual('Test Base Type', result.Type, 'Type should default.');
    Assert.areEqual(
      'Test Base Industry',
      result.Industry,
      'Industry should default.'
    );
  }

  @isTest
  static void shouldKeepCallerValues_WhenDefaultsAndFlavourExist() {
    useTestConfig();
    Account source = new Account(Name = 'Caller Account', Type = 'Caller Type');

    Test.startTest();
    Account result = (Account) DataFactory.create(source, 'FLAVOUR_A');
    Test.stopTest();

    Assert.areEqual('Caller Account', result.Name, 'Caller Name should win.');
    Assert.areEqual('Caller Type', result.Type, 'Caller Type should win.');
    Assert.areEqual(
      'Test Flavour A Ownership',
      result.Ownership,
      'Flavour-only field should still apply.'
    );
  }

  @isTest
  static void shouldApplyFlavourOverDefaults_WhenFlavourNameHasOtherCase() {
    useTestConfig();

    Test.startTest();
    Account result = (Account) DataFactory.create(new Account(), ' flavour_b ');
    Test.stopTest();

    Assert.areEqual(
      'Test Flavour B Type',
      result.Type,
      'Flavour should override the default Type.'
    );
    Assert.areEqual(
      'Test Default Account',
      result.Name,
      'Name should default.'
    );
  }

  @isTest
  static void shouldPreserveExplicitNull_WhenFieldHasDefault() {
    useTestConfig();

    Test.startTest();
    Account result = (Account) DataFactory.create(new Account(Type = null));
    Test.stopTest();

    Assert.isNull(result.Type, 'An explicit null should override the default.');
  }

  @isTest
  static void shouldNotModifySource_WhenCreatingRecord() {
    useTestConfig();
    Account source = new Account();

    Test.startTest();
    Account result = (Account) DataFactory.create(source);
    Test.stopTest();

    Assert.isFalse(
      source.isSet('Name'),
      'The source record should be unchanged.'
    );
    Assert.areEqual(
      'Test Default Account',
      result.Name,
      'The copy should get defaults.'
    );
  }

  @isTest
  static void shouldCopyUnchanged_WhenObjectIsNotConfigured() {
    useTestConfig();

    Test.startTest();
    Contact result = (Contact) DataFactory.create(
      new Contact(LastName = 'Smith')
    );
    Test.stopTest();

    Assert.areEqual(
      'Smith',
      result.LastName,
      'Supplied values should be kept.'
    );
    Assert.isFalse(result.isSet('FirstName'), 'No defaults should be added.');
  }

  @isTest
  static void shouldThrow_WhenFlavourIsUnknown() {
    useTestConfig();

    Test.startTest();
    try {
      DataFactory.create(new Account(), 'UNKNOWN');
      Assert.fail('Expected DataFactoryException for an unknown flavour.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.isTrue(
        e.getMessage().contains('Unknown flavour "UNKNOWN" for Account'),
        'Message should name the flavour and object: ' + e.getMessage()
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldThrow_WhenRecordListIsNull() {
    useTestConfig();

    Test.startTest();
    try {
      DataFactory.create((List<SObject>) null);
      Assert.fail('Expected DataFactoryException for a null list.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Source records must not be null.',
        e.getMessage(),
        'Message should explain the null input.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldBuildAllRecordsInOrder_WhenListIsBulk() {
    useTestConfig();
    List<SObject> sources = new List<SObject>();
    for (Integer index = 0; index < BULK_RECORD_COUNT; index++) {
      sources.add(new Account(Name = 'Account ' + index));
    }

    Test.startTest();
    List<SObject> results = DataFactory.create(sources, 'FLAVOUR_A');
    Test.stopTest();

    Assert.areEqual(
      BULK_RECORD_COUNT,
      results.size(),
      'Every record should be built.'
    );
    for (Integer index = 0; index < BULK_RECORD_COUNT; index++) {
      Account result = (Account) results[index];
      Assert.areEqual('Account ' + index, result.Name, 'Order should be kept.');
      Assert.areEqual(
        'Test Flavour A Type',
        result.Type,
        'Flavour should apply.'
      );
    }
  }

  @isTest
  static void shouldApplyEachObjectsDefaults_WhenListHasMixedObjects() {
    useTestConfig();

    Test.startTest();
    List<SObject> results = DataFactory.create(
      new List<SObject>{ new Account(), new Case() }
    );
    Test.stopTest();

    Assert.areEqual(
      'Test Default Account',
      ((Account) results[0]).Name,
      'Account defaults should apply.'
    );
    Assert.areEqual(
      'Test Default Case',
      ((Case) results[1]).Subject,
      'Case defaults should apply.'
    );
    Assert.areEqual(
      'Test Default Status',
      ((Case) results[1]).Status,
      'Case defaults should apply.'
    );
  }

  @isTest
  static void shouldThrow_WhenSingleRecordOrListElementIsNull() {
    useTestConfig();

    Test.startTest();
    try {
      DataFactory.create((SObject) null);
      Assert.fail('Expected DataFactoryException for a null record.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Source record must not be null.',
        e.getMessage(),
        'Message should explain the null record.'
      );
    }
    try {
      DataFactory.create(new List<SObject>{ new Account(), null });
      Assert.fail('Expected DataFactoryException for a null list element.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Source record must not be null.',
        e.getMessage(),
        'Message should explain the null list element.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldBuildRecordsByTypeAndCount_WhenUsingBulkOverloads() {
    useTestConfig();

    Test.startTest();
    List<SObject> baseAccounts = DataFactory.create(Account.SObjectType, 3);
    List<SObject> flavouredAccounts = DataFactory.create(
      Account.SObjectType,
      2,
      'FLAVOUR_A'
    );
    Test.stopTest();

    Assert.areEqual(3, baseAccounts.size(), 'Three base accounts expected.');
    Assert.areEqual(
      'Test Base Type',
      ((Account) baseAccounts[0]).Type,
      'Base defaults should apply.'
    );
    Assert.areEqual(
      2,
      flavouredAccounts.size(),
      'Two flavoured accounts expected.'
    );
    Assert.areEqual(
      'Test Flavour A Type',
      ((Account) flavouredAccounts[1]).Type,
      'Flavour values should apply.'
    );
  }

  @isTest
  static void shouldThrow_WhenBulkCountInputsAreInvalid() {
    useTestConfig();

    Test.startTest();
    try {
      DataFactory.create((Schema.SObjectType) null, 1);
      Assert.fail('Expected DataFactoryException for null SObjectType.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Object type must not be null.',
        e.getMessage(),
        'Message should explain null object type.'
      );
    }
    try {
      DataFactory.create(Account.SObjectType, -1);
      Assert.fail('Expected DataFactoryException for negative count.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Record count must be 0 or greater.',
        e.getMessage(),
        'Message should explain invalid count.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldPreserveFlavourDisplayCasing_WhenMatchingCaseInsensitively() {
    DataFactory.configByType = new Map<Schema.SObjectType, DataFactory.ObjectConfig>{
      Account.SObjectType => new DataFactory.ObjectConfig()
        .withDefaults(
          new Map<Schema.SObjectField, Object>{ Account.Name => 'Base' }
        )
        .withFlavour(
          'Customer',
          new Map<Schema.SObjectField, Object>{ Account.Type => 'Direct' }
        )
    };

    Test.startTest();
    List<String> names = DataFactory.getFlavourNames(Account.SObjectType);
    Account result = (Account) DataFactory.create(new Account(), 'customer');
    Test.stopTest();

    Assert.areEqual(
      new List<String>{ 'Customer' },
      names,
      'Configured display casing should be preserved.'
    );
    Assert.areEqual(
      'Direct',
      result.Type,
      'Flavour lookup should remain case-insensitive.'
    );
  }

  @isTest
  static void shouldValidateObjectConfigInputs_WhenConfiguringDefaultsOrFlavours() {
    DataFactory.ObjectConfig config = new DataFactory.ObjectConfig();

    Test.startTest();
    assertConfigThrows(
      config,
      null,
      null,
      null,
      'Default values must not be null.'
    );
    assertConfigThrows(
      config,
      ' ',
      new Map<Schema.SObjectField, Object>(),
      'flavour',
      'Flavour name must not be blank.'
    );
    assertConfigThrows(
      config,
      'Valid',
      null,
      'flavour',
      'Flavour values for "Valid" must not be null.'
    );
    assertConfigThrows(
      config,
      'Bad: Name',
      new Map<Schema.SObjectField, Object>(),
      'flavour',
      'Flavour name "Bad: Name" must not contain ": ".'
    );
    assertConfigThrows(
      config,
      'default',
      new Map<Schema.SObjectField, Object>(),
      'flavour',
      'Flavour name "default" is reserved for base defaults.'
    );
    Test.stopTest();
  }

  private static void assertConfigThrows(
    DataFactory.ObjectConfig config,
    String flavourName,
    Map<Schema.SObjectField, Object> values,
    String mode,
    String expectedMessage
  ) {
    try {
      if (mode == 'flavour') {
        config.withFlavour(flavourName, values);
      } else {
        config.withDefaults(values);
      }
      Assert.fail('Expected DataFactoryException: ' + expectedMessage);
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(expectedMessage, e.getMessage(), 'Message mismatch.');
    }
  }
}
