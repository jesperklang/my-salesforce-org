@isTest
private class DataFactoryFlowFlavourPicklistTest {
  @isTest
  static void shouldListEachFlowFlavourOption_WhenGettingValues() {
    DataFactoryTest.useTestConfig();
    List<String> expectedOptions = DataFactoryFlowCreate.getFlowFlavourOptions();

    Test.startTest();
    VisualEditor.DynamicPickListRows rows = new DataFactoryFlowFlavourPicklist()
      .getValues();
    Test.stopTest();

    Assert.areEqual(
      expectedOptions.size(),
      rows.size(),
      'One row per Flavour option expected.'
    );
    for (Integer index = 0; index < expectedOptions.size(); index++) {
      VisualEditor.DataRow row = rows.get(index);
      Assert.areEqual(
        expectedOptions[index],
        row.getLabel(),
        'Label should be the option.'
      );
      Assert.areEqual(
        expectedOptions[index],
        row.getValue(),
        'Value should be the option.'
      );
    }
  }

  @isTest
  static void shouldHaveNoDefault_WhenGettingDefaultValue() {
    Test.startTest();
    VisualEditor.DataRow defaultValue = new DataFactoryFlowFlavourPicklist()
      .getDefaultValue();
    Test.stopTest();

    Assert.isNull(defaultValue, 'The Flavour should be chosen explicitly.');
  }
}
