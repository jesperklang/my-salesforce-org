/**
 * Apex-defined flavour option for Salesforce Flow Collection Choice Sets.
 * Returned by DataFactoryFlowFlavours for use in screen picklists and radio buttons.
 * @see DataFactoryFlowFlavours
 */
public with sharing class DataFactoryFlowFlavourOption {
  @AuraEnabled
  @InvocableVariable(
    label='Label'
    description='Display label for the choice (the flavour name, or "Default" for base defaults).'
  )
  public String label;

  @AuraEnabled
  @InvocableVariable(
    label='Value'
    description='Flow flavour value in "[Object]: [Flavour]" format, ready for Build Record with Data Factory.'
  )
  public String value;

  @AuraEnabled
  @InvocableVariable(
    label='Flavour'
    description='Flavour name, or "Default" for base defaults.'
  )
  public String flavour;

  /**
   * Required no-argument constructor for Flow Apex-defined variables.
   */
  public DataFactoryFlowFlavourOption() {
  }

  /**
   * Creates a flavour option.
   * @param label Display label shown in the Flow choice component.
   * @param value Value in "[Object]: [Flavour]" format for DataFactoryFlowCreate.createFromFlow.
   * @param flavour Flavour name, or "Default" for base defaults.
   */
  public DataFactoryFlowFlavourOption(
    String label,
    String value,
    String flavour
  ) {
    this.label = label;
    this.value = value;
    this.flavour = flavour;
  }
}
