/**
 * Flow action that builds unsaved records with DataFactory defaults and flavours.
 * @see DataFactory
 * @see DataFactoryFlowFlavourPicklist
 */
public with sharing class DataFactoryFlowCreate {
  /**
   * Builds unsaved records from Flow. Each request's 'Flavour' selects the object and
   * flavour as "[Object]: [Flavour]", where "Default" applies the base defaults only.
   * Values already set on the 'Input Record' win over the defaults and flavour.
   * Configuration errors are thrown so the Flow takes its fault path.
   * @param requests Flow requests; the 'Input Record' may be empty to start from a new record.
   * @return One response per request, in input order, with the unsaved 'Output Record'.
   * @throws DataFactory.DataFactoryException If a request is null, a Flavour is malformed or unknown, or the Input Record is of another object.
   */
  @InvocableMethod(
    label='Build Record with Data Factory'
    description='Builds an unsaved record with Data Factory defaults and a flavour. Use Create Records to save it.'
    category='Data Factory'
  )
  public static List<FlowResponse> createFromFlow(List<FlowRequest> requests) {
    if (requests == null) {
      throw new DataFactory.DataFactoryException(
        'Flow requests must not be null.'
      );
    }

    List<FlowResponse> responses = new List<FlowResponse>();
    for (FlowRequest request : requests) {
      responses.add(buildFlowResponse(request));
    }
    return responses;
  }

  /**
   * Lists the Flow 'Flavour' options as "[Object]: [Flavour]", with "Default" (no flavour)
   * before the flavours of each configured object.
   * @return Options grouped by object, with objects sorted by label.
   * @see DataFactoryFlowFlavourPicklist
   */
  public static List<String> getFlowFlavourOptions() {
    List<String> options = new List<String>();
    for (
      DataFactoryController.ObjectFlavours objectFlavours : DataFactoryController.getObjectFlavours()
    ) {
      options.add(
        objectFlavours.objectApiName +
          DataFactory.FLOW_FLAVOUR_SEPARATOR +
          DataFactory.FLOW_DEFAULT_FLAVOUR
      );
      for (String flavourName : objectFlavours.flavours) {
        options.add(
          objectFlavours.objectApiName +
            DataFactory.FLOW_FLAVOUR_SEPARATOR +
            flavourName
        );
      }
    }
    return options;
  }

  private static FlowResponse buildFlowResponse(FlowRequest request) {
    if (request == null) {
      throw new DataFactory.DataFactoryException(
        'Flow request must not be null.'
      );
    }

    String option = request.flavour;
    if (
      String.isBlank(option) ||
      !option.contains(DataFactory.FLOW_FLAVOUR_SEPARATOR)
    ) {
      throw new DataFactory.DataFactoryException(
        'Flavour "' +
          option +
          '" must have the format "[Object]: [Flavour]", e.g. "Account: Default".'
      );
    }

    Schema.SObjectType objectType = DataFactory.getConfiguredType(
      option.substringBefore(DataFactory.FLOW_FLAVOUR_SEPARATOR)
    );
    SObject record = request.inputRecord ?? objectType.newSObject();
    if (record.getSObjectType() != objectType) {
      throw new DataFactory.DataFactoryException(
        'Input Record is a ' +
          record.getSObjectType().getDescribe().getName() +
          ', but Flavour "' +
          option +
          '" is for ' +
          objectType.getDescribe().getName() +
          '.'
      );
    }

    String rawFlavour = option.substringAfter(
        DataFactory.FLOW_FLAVOUR_SEPARATOR
      )
      .trim();
    String flavourName = DataFactory.FLOW_DEFAULT_FLAVOUR.equalsIgnoreCase(
        rawFlavour
      )
      ? null
      : rawFlavour;

    FlowResponse response = new FlowResponse();
    response.outputRecord = DataFactory.create(record, flavourName);
    response.overridesSummary = buildOverridesSummary(objectType, flavourName);
    return response;
  }

  private static String buildOverridesSummary(
    Schema.SObjectType objectType,
    String flavourName
  ) {
    if (String.isBlank(flavourName)) {
      return null;
    }

    Map<Schema.SObjectField, Object> defaults = DataFactory.getBaseDefaults(
      objectType
    );
    Map<Schema.SObjectField, Object> flavourValues = DataFactory.getFlavourValues(
      objectType,
      flavourName
    );
    List<String> lines = new List<String>();
    for (Schema.SObjectField field : defaults.keySet()) {
      if (
        flavourValues.containsKey(field) &&
        flavourValues.get(field) != defaults.get(field)
      ) {
        lines.add(
          '• ' +
            field.getDescribe().getLabel() +
            ': ' +
            String.valueOf(defaults.get(field)) +
            ' → ' +
            String.valueOf(flavourValues.get(field))
        );
      }
    }
    return lines.isEmpty() ? null : String.join(lines, '\n');
  }

  /**
   * A Flow request to build one record.
   */
  public class FlowRequest {
    @InvocableVariable(
      label='Input Record'
      description='Optional record whose set values win over the defaults and flavour. Leave empty to start from a new record.'
    )
    public SObject inputRecord;

    @InvocableVariable(
      label='Flavour'
      description='Object and flavour as "[Object]: [Flavour]". "Default" applies the base defaults only.'
      required=true
    )
    public String flavour;
  }

  /**
   * The unsaved record built for a Flow request.
   */
  public class FlowResponse {
    @InvocableVariable(
      label='Output Record'
      description='The unsaved record with defaults, flavour and Input Record values applied.'
    )
    public SObject outputRecord;

    @InvocableVariable(
      label='Overrides Summary'
      description='Summary of base default fields overridden by the selected flavour (field label: base value → flavour value). Blank when no defaults are overridden.'
    )
    public String overridesSummary;
  }
}
