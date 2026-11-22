/**
 * Builds in-memory records with precedence: base defaults, flavour, caller values.
 * Caller values (including explicit nulls) are preserved without changing the input.
 * String defaults, flavours, and caller-supplied values replace {0} with a transaction-wide, per-object sequence starting at 1.
 * No records are queried or saved.
 * @see DataFactoryConfig
 * @see DataFactoryController
 * @see DataFactoryFlowCreate
 */
public with sharing class DataFactory {
  public static final String FLOW_DEFAULT_FLAVOUR = 'Default';
  public static final String FLOW_FLAVOUR_SEPARATOR = ': ';

  @TestVisible
  private static Map<Schema.SObjectType, ObjectConfig> configByType;
  private static final String SEQUENCE_PLACEHOLDER = '{0}';
  private static final Map<Schema.SObjectType, Integer> SEQUENCE_BY_TYPE = new Map<Schema.SObjectType, Integer>();

  /**
   * Builds a record using its object's base defaults.
   * @param record Source record; explicitly set fields override defaults.
   * @return An independent copy with defaults for fields not set by the caller.
   * @throws DataFactoryException If the source record is null.
   */
  public static SObject create(SObject record) {
    return create(record, null);
  }

  /**
   * Builds a record using base defaults and an optional, case-insensitive flavour.
   * @param record Source record; explicitly set fields override the flavour.
   * @param flavour Flavour name; null or blank applies base defaults only.
   * @return An independent copy with defaults and flavour values applied.
   * @throws DataFactoryException If the record is null or the flavour is unknown.
   */
  public static SObject create(SObject record, String flavour) {
    return create(new List<SObject>{ record }, flavour)[0];
  }

  /**
   * Builds records using each object's base defaults.
   * @param records Source records; may contain different SObject types.
   * @return Independent copies in input order, or an empty list for empty input.
   * @throws DataFactoryException If the list or any source record is null.
   */
  public static List<SObject> create(List<SObject> records) {
    return create(records, null);
  }

  /**
   * Builds records using a flavour that must exist for every input object's type.
   * @param records Source records; may contain different SObject types.
   * @param flavour Flavour name; null or blank applies base defaults only.
   * @return Independent copies in input order, or an empty list for empty input.
   * @throws DataFactoryException If an input is null or a flavour is unknown.
   */
  public static List<SObject> create(List<SObject> records, String flavour) {
    if (records == null) {
      throw new DataFactoryException('Source records must not be null.');
    }

    String flavourKey = normalizeFlavourKey(flavour);
    Map<Schema.SObjectType, Map<Schema.SObjectField, Object>> valuesByType = new Map<Schema.SObjectType, Map<Schema.SObjectField, Object>>();
    List<SObject> results = new List<SObject>();
    for (SObject record : records) {
      if (record == null) {
        throw new DataFactoryException('Source record must not be null.');
      }
      Schema.SObjectType objectType = record.getSObjectType();
      if (!valuesByType.containsKey(objectType)) {
        valuesByType.put(
          objectType,
          getConfiguredValuesByKey(objectType, flavourKey)
        );
      }
      results.add(buildRecord(record, valuesByType.get(objectType)));
    }
    return results;
  }

  /**
   * Builds multiple new records of the given SObject type using its base defaults.
   * @param objectType SObject type to instantiate.
   * @param count Number of records to build; must be 0 or greater.
   * @return Independent records with base defaults applied.
   * @throws DataFactoryException If objectType is null or count is null or negative.
   */
  public static List<SObject> create(
    Schema.SObjectType objectType,
    Integer count
  ) {
    return create(objectType, count, null);
  }

  /**
   * Builds multiple new records of the given SObject type using base defaults and an optional flavour.
   * @param objectType SObject type to instantiate.
   * @param count Number of records to build; must be 0 or greater.
   * @param flavour Flavour name; null or blank applies base defaults only.
   * @return Independent records with defaults and flavour values applied.
   * @throws DataFactoryException If objectType is null, count is null or negative, or the flavour is unknown.
   */
  public static List<SObject> create(
    Schema.SObjectType objectType,
    Integer count,
    String flavour
  ) {
    if (objectType == null) {
      throw new DataFactoryException('Object type must not be null.');
    }
    if (count == null || count < 0) {
      throw new DataFactoryException('Record count must be 0 or greater.');
    }

    String flavourKey = normalizeFlavourKey(flavour);
    Map<Schema.SObjectField, Object> values = getConfiguredValuesByKey(
      objectType,
      flavourKey
    );
    List<SObject> results = new List<SObject>();
    for (Integer index = 0; index < count; index++) {
      results.add(buildRecord(objectType.newSObject(), values));
    }
    return results;
  }

  /**
   * Returns all SObject types configured in DataFactory.
   * @return Configured SObject types.
   */
  public static Set<Schema.SObjectType> getConfiguredTypes() {
    return new Set<Schema.SObjectType>(getConfigByType().keySet());
  }

  /**
   * Resolves a configured SObject type by its API name, case-insensitively.
   * @param objectApiName API name of a configured object.
   * @return The matching configured SObjectType.
   * @throws DataFactoryException If the object is not configured.
   */
  public static Schema.SObjectType getConfiguredType(String objectApiName) {
    if (String.isNotBlank(objectApiName)) {
      String trimmed = objectApiName.trim();
      for (Schema.SObjectType objectType : getConfigByType().keySet()) {
        if (objectType.getDescribe().getName().equalsIgnoreCase(trimmed)) {
          return objectType;
        }
      }
    }
    throw new DataFactoryException(
      'Object "' + objectApiName + '" is not configured in DataFactory.'
    );
  }

  /**
   * Returns the configured flavour display names for an SObject type in configuration order.
   * @param objectType The configured object type.
   * @return Flavour display names; empty if none are configured.
   */
  public static List<String> getFlavourNames(Schema.SObjectType objectType) {
    ObjectConfig config = getConfigByType().get(objectType);
    List<String> names = new List<String>();
    if (config != null) {
      for (FlavourConfig flavourConfig : config.flavours.values()) {
        names.add(flavourConfig.name);
      }
    }
    return names;
  }

  /**
   * Returns the base default field values for an SObject type.
   * @param objectType The SObject type.
   * @return Copy of the configured base defaults; empty if unconfigured.
   */
  public static Map<Schema.SObjectField, Object> getBaseDefaults(
    Schema.SObjectType objectType
  ) {
    ObjectConfig config = getConfigByType().get(objectType);
    return config == null
      ? new Map<Schema.SObjectField, Object>()
      : new Map<Schema.SObjectField, Object>(config.defaults);
  }

  /**
   * Returns the field values defined for a specific flavour (without base defaults merged).
   * @param objectType The SObject type.
   * @param flavourName Flavour name, case-insensitive.
   * @return Copy of the flavour's field values.
   * @throws DataFactoryException If the flavour is unknown for the object.
   */
  public static Map<Schema.SObjectField, Object> getFlavourValues(
    Schema.SObjectType objectType,
    String flavourName
  ) {
    String flavourKey = normalizeFlavourKey(flavourName);
    return new Map<Schema.SObjectField, Object>(
      getFlavourValuesByKey(
        objectType,
        getConfigByType().get(objectType),
        flavourKey
      )
    );
  }

  /**
   * Returns the merged field values (base defaults plus optional flavour) for an SObject type.
   * @param objectType The SObject type.
   * @param flavourName Flavour name, case-insensitive; null or blank returns base defaults only.
   * @return Merged field values.
   * @throws DataFactoryException If the flavour is unknown for the object.
   */
  public static Map<Schema.SObjectField, Object> getConfiguredValues(
    Schema.SObjectType objectType,
    String flavourName
  ) {
    return getConfiguredValuesByKey(
      objectType,
      normalizeFlavourKey(flavourName)
    );
  }

  private static Map<Schema.SObjectType, ObjectConfig> getConfigByType() {
    if (configByType == null) {
      configByType = DataFactoryConfig.getConfig();
    }
    return configByType;
  }

  private static String normalizeFlavourKey(String flavour) {
    return String.isBlank(flavour) ? null : flavour.trim().toUpperCase();
  }

  private static SObject buildRecord(
    SObject record,
    Map<Schema.SObjectField, Object> values
  ) {
    Schema.SObjectType objectType = record.getSObjectType();
    Integer sequence = (SEQUENCE_BY_TYPE.get(objectType) ?? 0) + 1;
    String sequenceText = String.valueOf(sequence);
    SObject result = record.clone(true, true, true, true);
    Map<String, Object> populatedFields = record.getPopulatedFieldsAsMap();
    for (String fieldName : populatedFields.keySet()) {
      Object value = populatedFields.get(fieldName);
      if (value instanceof String) {
        String stringValue = (String) value;
        if (stringValue.contains(SEQUENCE_PLACEHOLDER)) {
          result.put(
            fieldName,
            stringValue.replace(SEQUENCE_PLACEHOLDER, sequenceText)
          );
        }
      }
    }
    for (Schema.SObjectField field : values.keySet()) {
      // isSet distinguishes an explicit null from a field the caller omitted.
      if (!record.isSet(field)) {
        Object value = values.get(field);
        if (value instanceof String) {
          value = ((String) value).replace(SEQUENCE_PLACEHOLDER, sequenceText);
        }
        result.put(field, value);
      }
    }
    SEQUENCE_BY_TYPE.put(objectType, sequence);
    return result;
  }

  private static Map<Schema.SObjectField, Object> getConfiguredValuesByKey(
    Schema.SObjectType objectType,
    String flavourKey
  ) {
    ObjectConfig config = getConfigByType().get(objectType);
    Map<Schema.SObjectField, Object> values = new Map<Schema.SObjectField, Object>();
    if (config != null) {
      values.putAll(config.defaults);
    }

    if (flavourKey != null) {
      values.putAll(getFlavourValuesByKey(objectType, config, flavourKey));
    }
    return values;
  }

  private static Map<Schema.SObjectField, Object> getFlavourValuesByKey(
    Schema.SObjectType objectType,
    ObjectConfig config,
    String flavourKey
  ) {
    if (config == null || !config.flavours.containsKey(flavourKey)) {
      throw new DataFactoryException(
        'Unknown flavour "' +
          flavourKey +
          '" for ' +
          objectType.getDescribe().getName() +
          '.'
      );
    }
    return config.flavours.get(flavourKey).values;
  }

  private class FlavourConfig {
    public final String name;
    public final Map<Schema.SObjectField, Object> values;

    public FlavourConfig(String name, Map<Schema.SObjectField, Object> values) {
      this.name = name;
      this.values = new Map<Schema.SObjectField, Object>(values);
    }
  }

  /**
   * Fluent builder for an SObject's base defaults and named flavours.
   * @see DataFactoryConfig
   */
  public class ObjectConfig {
    public final Map<Schema.SObjectField, Object> defaults = new Map<Schema.SObjectField, Object>();
    private final Map<String, FlavourConfig> flavours = new Map<String, FlavourConfig>();

    /**
     * Adds base default field values for this object.
     * @param values Field values keyed by Schema.SObjectField; strings may contain {0} for the per-object sequence.
     * @return This ObjectConfig for chaining.
     * @throws DataFactoryException If values is null.
     */
    public ObjectConfig withDefaults(Map<Schema.SObjectField, Object> values) {
      if (values == null) {
        throw new DataFactoryException('Default values must not be null.');
      }
      defaults.putAll(values);
      return this;
    }

    /**
     * Registers a named flavour whose values override the base defaults.
     * @param name Flavour display name; matched case-insensitively.
     * @param values Field values keyed by Schema.SObjectField; strings may contain {0} for the per-object sequence.
     * @return This ObjectConfig for chaining.
     * @throws DataFactoryException If name is blank, reserved, contains ": ", or values is null.
     */
    public ObjectConfig withFlavour(
      String name,
      Map<Schema.SObjectField, Object> values
    ) {
      if (String.isBlank(name)) {
        throw new DataFactoryException('Flavour name must not be blank.');
      }
      if (values == null) {
        throw new DataFactoryException(
          'Flavour values for "' + name + '" must not be null.'
        );
      }
      String trimmed = name.trim();
      if (trimmed.contains(FLOW_FLAVOUR_SEPARATOR)) {
        throw new DataFactoryException(
          'Flavour name "' +
            trimmed +
            '" must not contain "' +
            FLOW_FLAVOUR_SEPARATOR +
            '".'
        );
      }
      if (FLOW_DEFAULT_FLAVOUR.equalsIgnoreCase(trimmed)) {
        throw new DataFactoryException(
          'Flavour name "' + trimmed + '" is reserved for base defaults.'
        );
      }
      flavours.put(trimmed.toUpperCase(), new FlavourConfig(trimmed, values));
      return this;
    }
  }

  /**
   * Signals invalid DataFactory inputs or unsupported flavours.
   */
  public class DataFactoryException extends Exception {
  }
}
