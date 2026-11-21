/**
 * Apex-defined object option for Salesforce Flow Collection Choice Sets.
 * Returned by DataFactoryFlowObjects for use in screen picklists and radio buttons.
 * @see DataFactoryFlowObjects
 */
public with sharing class DataFactoryFlowObjectOption {
  @AuraEnabled
  @InvocableVariable(
    label='Label'
    description='Display label of the configured object, e.g. Account.'
  )
  public String label;

  @AuraEnabled
  @InvocableVariable(
    label='Object API Name'
    description='API name of the configured object, e.g. Account.'
  )
  public String objectApiName;

  /**
   * Required no-argument constructor for Flow Apex-defined variables.
   */
  public DataFactoryFlowObjectOption() {
  }

  /**
   * Creates an object option.
   * @param label Display label of the object.
   * @param objectApiName API name of the object.
   */
  public DataFactoryFlowObjectOption(String label, String objectApiName) {
    this.label = label;
    this.objectApiName = objectApiName;
  }
}
