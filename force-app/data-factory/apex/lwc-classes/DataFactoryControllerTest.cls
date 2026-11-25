@isTest
private class DataFactoryControllerTest {
  @isTest
  static void shouldListConfiguredObjectsSortedByLabel_WhenGettingObjectFlavours() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    List<DataFactoryController.ObjectFlavours> results = DataFactoryController.getObjectFlavours();
    Test.stopTest();

    Map<String, DataFactoryController.ObjectFlavours> resultsByApiName = new Map<String, DataFactoryController.ObjectFlavours>();
    for (Integer index = 0; index < results.size(); index++) {
      resultsByApiName.put(results[index].objectApiName, results[index]);
      if (index > 0) {
        Assert.isTrue(
          results[index - 1].label.compareTo(results[index].label) <= 0,
          'Objects should be sorted by label.'
        );
      }
    }
    Assert.areEqual(
      new List<String>{ 'FLAVOUR_A', 'FLAVOUR_B' },
      resultsByApiName.get('Account').flavours,
      'Account should list its flavours.'
    );
    Assert.areEqual(
      Account.SObjectType.getDescribe().getLabel(),
      resultsByApiName.get('Account').label,
      'Account should expose its label.'
    );
    Assert.isTrue(
      resultsByApiName.get('Case').flavours.isEmpty(),
      'Case should be listed without flavours.'
    );
  }

  @isTest
  static void shouldReturnFlavours_WhenObjectIsConfigured() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    List<String> flavours = DataFactoryController.getFlavours('account');
    Test.stopTest();

    Assert.areEqual(
      new List<String>{ 'FLAVOUR_A', 'FLAVOUR_B' },
      flavours,
      'Flavours should be returned case-insensitively by object name.'
    );
  }

  @isTest
  static void shouldThrowAuraException_WhenGettingFlavoursOfUnconfiguredObject() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    try {
      DataFactoryController.getFlavours('Contact');
      Assert.fail('Expected AuraHandledException for an unconfigured object.');
    } catch (AuraHandledException e) {
      Assert.areEqual(
        'Object "Contact" is not configured in DataFactory.',
        e.getMessage(),
        'Message should name the object.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldReturnBaseThenMergedFlavourValues_WhenGettingFlavourDefaults() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    List<DataFactoryController.FlavourDefaults> results = DataFactoryController.getFlavourDefaults(
      ' account '
    );
    Test.stopTest();

    Assert.areEqual(3, results.size(), 'Base plus each flavour expected.');
    assertFlavourDefaults(
      results[0],
      null,
      new Map<String, Object>{
        'Name' => 'Test Default Account',
        'Type' => 'Test Base Type',
        'Industry' => 'Test Base Industry'
      }
    );
    assertFlavourDefaults(
      results[1],
      'FLAVOUR_A',
      new Map<String, Object>{
        'Name' => 'Test Default Account',
        'Type' => 'Test Flavour A Type',
        'Industry' => 'Test Base Industry',
        'Ownership' => 'Test Flavour A Ownership'
      }
    );
    assertFlavourDefaults(
      results[2],
      'FLAVOUR_B',
      new Map<String, Object>{
        'Name' => 'Test Default Account',
        'Type' => 'Test Flavour B Type',
        'Industry' => 'Test Base Industry'
      }
    );
  }

  @isTest
  static void shouldReturnOnlyBaseDefaults_WhenObjectHasNoFlavours() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    List<DataFactoryController.FlavourDefaults> results = DataFactoryController.getFlavourDefaults(
      'Case'
    );
    Test.stopTest();

    Assert.areEqual(1, results.size(), 'Only the base defaults expected.');
    Assert.isNull(results[0].flavour, 'Base defaults have no flavour.');
    Assert.areEqual(
      new Map<String, Object>{
        'Subject' => 'Test Default Case',
        'Status' => 'Test Default Status'
      },
      results[0].fieldValues,
      'Case defaults should be keyed by field API name.'
    );
  }

  @isTest
  static void shouldThrowAuraException_WhenGettingFlavourDefaultsOfUnconfiguredObject() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    try {
      DataFactoryController.getFlavourDefaults('Contact');
      Assert.fail('Expected AuraHandledException for an unconfigured object.');
    } catch (AuraHandledException e) {
      Assert.areEqual(
        'Object "Contact" is not configured in DataFactory.',
        e.getMessage(),
        'Message should name the object.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldBuildRecord_WhenCreatingFromLwcInput() {
    DataFactoryTest.useTestConfig();
    Map<String, Object> fieldValues = new Map<String, Object>{
      'name' => 'Acme',
      'Description' => null
    };

    Test.startTest();
    Account result = (Account) DataFactoryController.createRecord(
      'Account',
      fieldValues,
      'FLAVOUR_B'
    );
    Test.stopTest();

    Assert.areEqual('Acme', result.Name, 'Supplied Name should win.');
    Assert.areEqual(
      'Test Flavour B Type',
      result.Type,
      'Flavour should apply.'
    );
    Assert.isTrue(result.isSet('Description'), 'Explicit null should be kept.');
  }

  @isTest
  static void shouldApplyDefaults_WhenCreatingFromLwcWithoutFieldValues() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    Case result = (Case) DataFactoryController.createRecord('Case', null, null);
    Test.stopTest();

    Assert.areEqual(
      'Test Default Case',
      result.Subject,
      'Subject should default.'
    );
    Assert.areEqual(
      'Test Default Status',
      result.Status,
      'Status should default.'
    );
  }

  @isTest
  static void shouldConvertValueTypes_WhenCreatingFromLwcInput() {
    DataFactoryTest.useTestConfig();
    Map<String, Object> fieldValues = new Map<String, Object>{
      'SlaStartDate' => '2026-11-06T10:00:00.000Z'
    };

    Test.startTest();
    Case result = (Case) DataFactoryController.createRecord(
      'Case',
      fieldValues,
      null
    );
    Test.stopTest();

    Assert.areEqual(
      Datetime.newInstanceGmt(2026, 11, 6, 10, 0, 0),
      result.SlaStartDate,
      'ISO strings should be converted to Datetime.'
    );
    Assert.areEqual(
      'Test Default Status',
      result.Status,
      'Unsupplied fields should still default.'
    );
  }

  @isTest
  static void shouldThrowAuraException_WhenFieldIsUnknown() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    try {
      DataFactoryController.createRecord(
        'Account',
        new Map<String, Object>{ 'NotAField' => 'x' },
        null
      );
      Assert.fail('Expected AuraHandledException for an unknown field.');
    } catch (AuraHandledException e) {
      Assert.areEqual(
        'Unknown field "NotAField" on Account.',
        e.getMessage(),
        'Message should name the field.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldThrowAuraException_WhenValueHasWrongType() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    try {
      DataFactoryController.createRecord(
        'Account',
        new Map<String, Object>{ 'NumberOfEmployees' => 'many' },
        null
      );
      Assert.fail('Expected AuraHandledException for an invalid value.');
    } catch (AuraHandledException e) {
      Assert.isTrue(
        e.getMessage().startsWith('Invalid field values for Account'),
        'Message should explain the invalid value: ' + e.getMessage()
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldThrowAuraException_WhenCreatingFromLwcWithUnknownFlavour() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    try {
      DataFactoryController.createRecord('Case', null, 'UNKNOWN');
      Assert.fail('Expected AuraHandledException for an unknown flavour.');
    } catch (AuraHandledException e) {
      Assert.areEqual(
        'Unknown flavour "UNKNOWN" for Case.',
        e.getMessage(),
        'Message should name the flavour and object.'
      );
    }
    Test.stopTest();
  }

  private static void assertFlavourDefaults(
    DataFactoryController.FlavourDefaults result,
    String expectedFlavour,
    Map<String, Object> expectedValues
  ) {
    Assert.areEqual(expectedFlavour, result.flavour, 'Flavour name mismatch.');
    Assert.areEqual(
      expectedValues,
      result.fieldValues,
      'Flavour values should be merged over the defaults.'
    );
  }
}
