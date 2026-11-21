@isTest
private class DataFactoryFlowCreateTest {
  private static final Integer BULK_RECORD_COUNT = 251;

  @isTest
  static void shouldBuildNewFlavouredRecord_WhenFlowSendsNoInputRecord() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    Account result = (Account) buildFromFlow(null, 'Account: FLAVOUR_A');
    Test.stopTest();

    Assert.areEqual(
      'Test Default Account',
      result.Name,
      'Name should default.'
    );
    Assert.areEqual(
      'Test Flavour A Type',
      result.Type,
      'Flavour should apply.'
    );
  }

  @isTest
  static void shouldApplyBaseDefaultsAndKeepInputValues_WhenFlowFlavourIsDefault() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    Account result = (Account) buildFromFlow(
      new Account(Name = 'Flow Account'),
      'Account: Default'
    );
    Test.stopTest();

    Assert.areEqual('Flow Account', result.Name, 'Input Name should win.');
    Assert.areEqual(
      'Test Base Type',
      result.Type,
      'Base default Type expected.'
    );
  }

  @isTest
  static void shouldReturnResponsesInOrder_WhenFlowSendsBulkRequests() {
    DataFactoryTest.useTestConfig();
    List<DataFactoryFlowCreate.FlowRequest> requests = new List<DataFactoryFlowCreate.FlowRequest>();
    for (Integer index = 0; index < BULK_RECORD_COUNT; index++) {
      requests.add(
        newFlowRequest(
          new Account(Name = 'Account ' + index),
          'Account: FLAVOUR_B'
        )
      );
    }

    Test.startTest();
    List<DataFactoryFlowCreate.FlowResponse> responses = DataFactoryFlowCreate.createFromFlow(
      requests
    );
    Test.stopTest();

    Assert.areEqual(
      BULK_RECORD_COUNT,
      responses.size(),
      'One response per request expected.'
    );
    for (Integer index = 0; index < BULK_RECORD_COUNT; index++) {
      Account result = (Account) responses[index].outputRecord;
      Assert.areEqual('Account ' + index, result.Name, 'Order should be kept.');
      Assert.areEqual(
        'Test Flavour B Type',
        result.Type,
        'Flavour should apply.'
      );
    }
  }

  @isTest
  static void shouldThrow_WhenFlowRequestsListIsNull() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    try {
      DataFactoryFlowCreate.createFromFlow(null);
      Assert.fail('Expected DataFactoryException for a null requests list.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Flow requests must not be null.',
        e.getMessage(),
        'Message should explain the null input.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldThrow_WhenFlowRequestElementIsNull() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    try {
      DataFactoryFlowCreate.createFromFlow(
        new List<DataFactoryFlowCreate.FlowRequest>{ null }
      );
      Assert.fail('Expected DataFactoryException for a null request.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Flow request must not be null.',
        e.getMessage(),
        'Message should explain the null request.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldThrow_WhenFlowFlavourHasNoObject() {
    DataFactoryTest.useTestConfig();
    assertFlowThrows(
      null,
      'FLAVOUR_A',
      'Flavour "FLAVOUR_A" must have the format "[Object]: [Flavour]", e.g. "Account: Default".'
    );
  }

  @isTest
  static void shouldThrow_WhenFlowInputRecordIsOfAnotherObject() {
    DataFactoryTest.useTestConfig();
    assertFlowThrows(
      new Contact(LastName = 'Smith'),
      'Account: Default',
      'Input Record is a Contact, but Flavour "Account: Default" is for Account.'
    );
  }

  @isTest
  static void shouldThrow_WhenFlowFlavourIsUnknown() {
    DataFactoryTest.useTestConfig();
    assertFlowThrows(
      null,
      'Account: UNKNOWN',
      'Unknown flavour "UNKNOWN" for Account.'
    );
  }

  @isTest
  static void shouldListDefaultThenFlavoursPerObject_WhenGettingFlowFlavourOptions() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    List<String> options = DataFactoryFlowCreate.getFlowFlavourOptions();
    Test.stopTest();

    Assert.areEqual(
      new List<String>{
        'Account: Default',
        'Account: FLAVOUR_A',
        'Account: FLAVOUR_B',
        'Case: Default'
      },
      options,
      'Options should be grouped by object, Default first.'
    );
  }

  @isTest
  static void shouldReturnOverridesSummary_WhenFlowFlavourOverridesDefaults() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    List<DataFactoryFlowCreate.FlowResponse> responses = DataFactoryFlowCreate.createFromFlow(
      new List<DataFactoryFlowCreate.FlowRequest>{
        newFlowRequest(null, 'Account: Default'),
        newFlowRequest(null, 'Account: FLAVOUR_A')
      }
    );
    Test.stopTest();

    Assert.isNull(
      responses[0].overridesSummary,
      'Base defaults should have no overrides summary.'
    );
    Assert.areEqual(
      '• ' +
        Account.Type.getDescribe().getLabel() +
        ': Test Base Type → Test Flavour A Type',
      responses[1].overridesSummary,
      'Overridden default fields should be listed with an arrow.'
    );
  }

  private static SObject buildFromFlow(SObject inputRecord, String flavour) {
    return DataFactoryFlowCreate.createFromFlow(
        new List<DataFactoryFlowCreate.FlowRequest>{
          newFlowRequest(inputRecord, flavour)
        }
      )[0]
      .outputRecord;
  }

  private static DataFactoryFlowCreate.FlowRequest newFlowRequest(
    SObject inputRecord,
    String flavour
  ) {
    DataFactoryFlowCreate.FlowRequest request = new DataFactoryFlowCreate.FlowRequest();
    request.inputRecord = inputRecord;
    request.flavour = flavour;
    return request;
  }

  private static void assertFlowThrows(
    SObject inputRecord,
    String flavour,
    String expectedMessage
  ) {
    Test.startTest();
    try {
      buildFromFlow(inputRecord, flavour);
      Assert.fail('Expected DataFactoryException for Flavour ' + flavour);
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(expectedMessage, e.getMessage(), 'Message mismatch.');
    }
    Test.stopTest();
  }
}
