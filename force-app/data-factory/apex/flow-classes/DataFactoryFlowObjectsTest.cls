@isTest
private class DataFactoryFlowObjectsTest {
  @isTest
  static void shouldReturnConfiguredObjectOptions_WhenGettingObjects() {
    DataFactoryTest.useTestConfig();

    Test.startTest();
    List<DataFactoryFlowObjects.FlowResponse> responses = DataFactoryFlowObjects.getObjects();
    Test.stopTest();

    Assert.areEqual(1, responses.size(), 'Single response expected.');
    List<DataFactoryFlowObjectOption> options = responses[0].options;
    Assert.areEqual(2, options.size(), 'Two configured objects expected.');
    Assert.areEqual('Account', options[0].objectApiName);
    Assert.areEqual(
      Account.SObjectType.getDescribe().getLabel(),
      options[0].label
    );
    Assert.areEqual('Case', options[1].objectApiName);
    Assert.areEqual(
      Case.SObjectType.getDescribe().getLabel(),
      options[1].label
    );
  }

  @isTest
  static void shouldSupportNoArgConstructor_WhenInstantiatingObjectOption() {
    Test.startTest();
    DataFactoryFlowObjectOption option = new DataFactoryFlowObjectOption();
    Test.stopTest();

    Assert.isNull(option.label, 'Label should start null.');
    Assert.isNull(option.objectApiName, 'Object API name should start null.');
  }
}
