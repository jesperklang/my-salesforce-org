/**
 * Flow action that lists the configured Data Factory flavours of an object as an
 * Apex-defined collection, so Flows can populate a Collection Choice Set without
 * hardcoding flavour choices.
 * @see DataFactory
 * @see DataFactoryFlowFlavourOption
 */
public with sharing class DataFactoryFlowFlavours {
  /**
   * Returns the Data Factory flavour options for each requested object.
   * @param requests Requests specifying the object API name.
   * @return One response per request containing the Apex-defined flavour options collection.
   * @throws DataFactory.DataFactoryException If an object is not configured.
   */
  @InvocableMethod(
    label='Get Data Factory Flavours'
    description='Lists the configured Data Factory flavours of an object as an Apex-defined collection for Flow Collection Choice Sets.'
    category='Data Factory'
  )
  public static List<FlowResponse> getFlavours(List<FlowRequest> requests) {
    if (requests == null) {
      throw new DataFactory.DataFactoryException(
        'Flow requests must not be null.'
      );
    }

    List<FlowResponse> responses = new List<FlowResponse>();
    for (FlowRequest request : requests) {
      if (request == null) {
        throw new DataFactory.DataFactoryException(
          'Flow request must not be null.'
        );
      }
      FlowResponse response = new FlowResponse();
      response.options = buildFlavourOptions(request.objectApiName);
      responses.add(response);
    }
    return responses;
  }

  private static List<DataFactoryFlowFlavourOption> buildFlavourOptions(
    String objectApiName
  ) {
    Schema.SObjectType objectType = DataFactory.getConfiguredType(
      objectApiName
    );
    String exactObjectName = objectType.getDescribe().getName();

    List<DataFactoryFlowFlavourOption> options = new List<DataFactoryFlowFlavourOption>{
      new DataFactoryFlowFlavourOption(
        DataFactory.FLOW_DEFAULT_FLAVOUR,
        exactObjectName +
          DataFactory.FLOW_FLAVOUR_SEPARATOR +
          DataFactory.FLOW_DEFAULT_FLAVOUR,
        DataFactory.FLOW_DEFAULT_FLAVOUR
      )
    };
    for (String flavourName : DataFactory.getFlavourNames(objectType)) {
      options.add(
        new DataFactoryFlowFlavourOption(
          flavourName,
          exactObjectName + DataFactory.FLOW_FLAVOUR_SEPARATOR + flavourName,
          flavourName
        )
      );
    }
    return options;
  }

  /**
   * Flow request for the Data Factory flavour options of one object.
   */
  public class FlowRequest {
    @InvocableVariable(
      label='Object API Name'
      description='API name of a configured object in DataFactory, e.g. Account.'
      required=true
    )
    public String objectApiName;
  }

  /**
   * Flow response containing the Apex-defined collection of flavour options.
   */
  public class FlowResponse {
    @InvocableVariable(
      label='Flavour Options'
      description='Collection of DataFactoryFlowFlavourOption records for a Collection Choice Set.'
    )
    public List<DataFactoryFlowFlavourOption> options;
  }
}
