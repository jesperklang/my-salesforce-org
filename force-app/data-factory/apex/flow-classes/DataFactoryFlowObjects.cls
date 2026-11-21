/**
 * Flow action that lists the objects configured in Data Factory as an
 * Apex-defined collection, so Flows can populate a Collection Choice Set
 * without hardcoding object choices.
 * @see DataFactory
 * @see DataFactoryFlowObjectOption
 */
public with sharing class DataFactoryFlowObjects {
  /**
   * Returns the configured Data Factory objects as Apex-defined options sorted by label.
   * @return Single-element response list containing the object options collection.
   */
  @InvocableMethod(
    label='Get Data Factory Objects'
    description='Lists the objects configured in Data Factory as an Apex-defined collection for Flow Collection Choice Sets.'
    category='Data Factory'
  )
  public static List<FlowResponse> getObjects() {
    FlowResponse response = new FlowResponse();
    response.options = new List<DataFactoryFlowObjectOption>();
    for (
      DataFactoryController.ObjectFlavours objectFlavours : DataFactoryController.getObjectFlavours()
    ) {
      response.options.add(
        new DataFactoryFlowObjectOption(
          objectFlavours.label,
          objectFlavours.objectApiName
        )
      );
    }
    return new List<FlowResponse>{ response };
  }

  /**
   * Flow response containing the Apex-defined collection of object options.
   */
  public class FlowResponse {
    @InvocableVariable(
      label='Object Options'
      description='Collection of DataFactoryFlowObjectOption records for a Collection Choice Set.'
    )
    public List<DataFactoryFlowObjectOption> options;
  }
}
