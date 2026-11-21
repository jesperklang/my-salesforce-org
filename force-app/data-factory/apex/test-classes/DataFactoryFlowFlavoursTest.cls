@isTest
private class DataFactoryFlowFlavoursTest {
  @isTest
  static void shouldReturnFlavourOptionsPerObject_WhenGettingFlavours() {
    DataFactoryTest.useTestConfig();
    DataFactoryFlowFlavours.FlowRequest accountRequest = new DataFactoryFlowFlavours.FlowRequest();
    accountRequest.objectApiName = 'Account';
    DataFactoryFlowFlavours.FlowRequest caseRequest = new DataFactoryFlowFlavours.FlowRequest();
    caseRequest.objectApiName = 'Case';

    Test.startTest();
    List<DataFactoryFlowFlavours.FlowResponse> responses = DataFactoryFlowFlavours.getFlavours(
      new List<DataFactoryFlowFlavours.FlowRequest>{
        accountRequest,
        caseRequest
      }
    );
    Test.stopTest();

    Assert.areEqual(2, responses.size(), 'One response per request expected.');
    Assert.areEqual(
      3,
      responses[0].options.size(),
      'Account should return Default plus its two flavours.'
    );
    Assert.areEqual('Default', responses[0].options[0].label);
    Assert.areEqual('Account: Default', responses[0].options[0].value);
    Assert.areEqual('Default', responses[0].options[0].flavour);
    Assert.areEqual('FLAVOUR_A', responses[0].options[1].label);
    Assert.areEqual('Account: FLAVOUR_A', responses[0].options[1].value);
    Assert.areEqual('FLAVOUR_B', responses[0].options[2].label);
    Assert.areEqual('Account: FLAVOUR_B', responses[0].options[2].value);

    Assert.areEqual(
      1,
      responses[1].options.size(),
      'Case should return only Default.'
    );
    Assert.areEqual('Default', responses[1].options[0].label);
    Assert.areEqual('Case: Default', responses[1].options[0].value);
  }

  @isTest
  static void shouldThrow_WhenObjectIsNotConfigured() {
    DataFactoryTest.useTestConfig();
    DataFactoryFlowFlavours.FlowRequest request = new DataFactoryFlowFlavours.FlowRequest();
    request.objectApiName = 'Contact';

    Test.startTest();
    try {
      DataFactoryFlowFlavours.getFlavours(
        new List<DataFactoryFlowFlavours.FlowRequest>{ request }
      );
      Assert.fail('Expected DataFactoryException for an unconfigured object.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Object "Contact" is not configured in DataFactory.',
        e.getMessage(),
        'Message should name the unconfigured object.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldThrow_WhenRequestsOrElementIsNull() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    try {
      DataFactoryFlowFlavours.getFlavours(null);
      Assert.fail('Expected DataFactoryException for null requests.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Flow requests must not be null.',
        e.getMessage(),
        'Message should explain null requests.'
      );
    }
    try {
      DataFactoryFlowFlavours.getFlavours(
        new List<DataFactoryFlowFlavours.FlowRequest>{ null }
      );
      Assert.fail('Expected DataFactoryException for null request element.');
    } catch (DataFactory.DataFactoryException e) {
      Assert.areEqual(
        'Flow request must not be null.',
        e.getMessage(),
        'Message should explain null request.'
      );
    }
    Test.stopTest();
  }

  @isTest
  static void shouldSupportNoArgConstructor_WhenInstantiatingFlavourOption() {
    Test.startTest();
    DataFactoryFlowFlavourOption option = new DataFactoryFlowFlavourOption();
    Test.stopTest();

    Assert.isNull(option.label, 'Label should start null.');
    Assert.isNull(option.value, 'Value should start null.');
    Assert.isNull(option.flavour, 'Flavour should start null.');
  }
}
