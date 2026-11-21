/**
 * Lightning Web Component controller for DataFactory.
 * Exposes configured objects, flavours, default field values, and unsaved record creation.
 * @see DataFactory
 */
public with sharing class DataFactoryController {
  /**
   * Lists the configured objects and their flavours.
   * @return Configured objects sorted by label; objects without flavours have an empty list.
   * @example
   * {@code
   * import getObjectFlavours from '@salesforce/apex/DataFactoryController.getObjectFlavours';
   * const objects = await getObjectFlavours();
   * }
   */
  @AuraEnabled(cacheable=true)
  public static List<ObjectFlavours> getObjectFlavours() {
    List<ObjectFlavours> results = new List<ObjectFlavours>();
    for (Schema.SObjectType objectType : DataFactory.getConfiguredTypes()) {
      results.add(
        new ObjectFlavours(objectType, DataFactory.getFlavourNames(objectType))
      );
    }
    results.sort();
    return results;
  }

  /**
   * Lists the flavours of a configured object.
   * @param objectApiName API name of a configured object, case-insensitive.
   * @return Flavour names in configuration order; empty if the object has none.
   * @throws AuraHandledException If the object is not configured.
   * @example
   * {@code
   * import getFlavours from '@salesforce/apex/DataFactoryController.getFlavours';
   * const flavours = await getFlavours({ objectApiName: 'Account' });
   * }
   */
  @AuraEnabled(cacheable=true)
  public static List<String> getFlavours(String objectApiName) {
    try {
      Schema.SObjectType objectType = DataFactory.getConfiguredType(
        objectApiName
      );
      return DataFactory.getFlavourNames(objectType);
    } catch (DataFactory.DataFactoryException e) {
      throw newAuraHandledException(e.getMessage());
    }
  }

  /**
   * Lists the configured field values of a configured object: first its base defaults,
   * then one entry per flavour with the flavour values merged over the defaults.
   * @param objectApiName API name of a configured object, case-insensitive.
   * @return Base defaults (flavour null) followed by each flavour in configuration order.
   * @throws AuraHandledException If the object is not configured.
   * @example
   * {@code
   * import getFlavourDefaults from '@salesforce/apex/DataFactoryController.getFlavourDefaults';
   * const defaults = await getFlavourDefaults({ objectApiName: 'Account' });
   * }
   */
  @AuraEnabled(cacheable=true)
  public static List<FlavourDefaults> getFlavourDefaults(String objectApiName) {
    try {
      Schema.SObjectType objectType = DataFactory.getConfiguredType(
        objectApiName
      );
      List<FlavourDefaults> results = new List<FlavourDefaults>{
        new FlavourDefaults(
          null,
          DataFactory.getConfiguredValues(objectType, null)
        )
      };
      for (String flavourName : DataFactory.getFlavourNames(objectType)) {
        results.add(
          new FlavourDefaults(
            flavourName,
            DataFactory.getConfiguredValues(objectType, flavourName)
          )
        );
      }
      return results;
    } catch (DataFactory.DataFactoryException e) {
      throw newAuraHandledException(e.getMessage());
    }
  }

  /**
   * Builds an unsaved record of a configured object, applying defaults and flavour before the supplied field values.
   * @param objectApiName API name of a configured object, case-insensitive.
   * @param fieldValues Field values by field API name; may be null.
   * @param flavour Flavour name; null or blank applies base defaults only.
   * @return The unsaved record.
   * @throws AuraHandledException If the object is not configured, the flavour is unknown, or a field name or value is invalid.
   * @example
   * {@code
   * import createRecord from '@salesforce/apex/DataFactoryController.createRecord';
   * const account = await createRecord({
   *   objectApiName: 'Account',
   *   fieldValues: { Name: 'Acme' },
   *   flavour: 'Customer'
   * });
   * }
   */
  @AuraEnabled
  public static SObject createRecord(
    String objectApiName,
    Map<String, Object> fieldValues,
    String flavour
  ) {
    try {
      Schema.SObjectType objectType = DataFactory.getConfiguredType(
        objectApiName
      );
      return DataFactory.create(toRecord(objectType, fieldValues), flavour);
    } catch (DataFactory.DataFactoryException e) {
      throw newAuraHandledException(e.getMessage());
    } catch (JSONException e) {
      throw newAuraHandledException(
        'Invalid field values for ' + objectApiName + ': ' + e.getMessage()
      );
    } catch (SObjectException e) {
      throw newAuraHandledException(
        'Invalid field values for ' + objectApiName + ': ' + e.getMessage()
      );
    }
  }

  // Copies only the supplied fields; deserializing straight into a record can also
  // mark untouched fields as set, which would block their defaults.
  private static SObject toRecord(
    Schema.SObjectType objectType,
    Map<String, Object> fieldValues
  ) {
    SObject record = objectType.newSObject();
    if (fieldValues == null || fieldValues.isEmpty()) {
      return record;
    }

    Schema.DescribeSObjectResult describe = objectType.getDescribe();
    Map<String, Schema.SObjectField> fieldsByName = describe.fields.getMap();
    for (String fieldName : fieldValues.keySet()) {
      if (!fieldsByName.containsKey(fieldName)) {
        throw new DataFactory.DataFactoryException(
          'Unknown field "' + fieldName + '" on ' + describe.getName() + '.'
        );
      }
    }

    // Schema-qualified Type.forName avoids shadowing by top-level Apex classes.
    SObject parsed = (SObject) JSON.deserialize(
      JSON.serialize(fieldValues),
      Type.forName('Schema.' + describe.getName())
    );
    for (String fieldName : fieldValues.keySet()) {
      Schema.SObjectField field = fieldsByName.get(fieldName);
      record.put(field, parsed.get(field));
    }
    return record;
  }

  private static AuraHandledException newAuraHandledException(String message) {
    AuraHandledException auraException = new AuraHandledException(message);
    auraException.setMessage(message);
    return auraException;
  }

  /**
   * A configured object and its flavour names, returned to Lightning components.
   */
  public class ObjectFlavours implements Comparable {
    @AuraEnabled
    public String objectApiName { get; private set; }
    @AuraEnabled
    public String label { get; private set; }
    @AuraEnabled
    public List<String> flavours { get; private set; }

    /**
     * @param objectType The configured object.
     * @param flavourNames The object's flavour names.
     */
    public ObjectFlavours(
      Schema.SObjectType objectType,
      List<String> flavourNames
    ) {
      Schema.DescribeSObjectResult describe = objectType.getDescribe();
      objectApiName = describe.getName();
      label = describe.getLabel();
      flavours = new List<String>(flavourNames);
    }

    /**
     * Orders objects by label.
     * @param other Another ObjectFlavours instance.
     * @return Negative, zero, or positive per String.compareTo.
     */
    public Integer compareTo(Object other) {
      return label.compareTo(((ObjectFlavours) other).label);
    }
  }

  /**
   * The configured field values of an object for one flavour, returned to Lightning components.
   */
  public class FlavourDefaults {
    /**
     * Flavour name, or null for the base defaults.
     */
    @AuraEnabled
    public String flavour { get; private set; }
    /**
     * Configured field values by field API name.
     */
    @AuraEnabled
    public Map<String, Object> fieldValues { get; private set; }

    /**
     * Keys the configured values by field API name.
     * @param flavour Flavour name, or null for the base defaults.
     * @param values Field values with the flavour merged over the base defaults.
     */
    public FlavourDefaults(
      String flavour,
      Map<Schema.SObjectField, Object> values
    ) {
      this.flavour = flavour;
      fieldValues = new Map<String, Object>();
      for (Schema.SObjectField field : values.keySet()) {
        fieldValues.put(field.getDescribe().getName(), values.get(field));
      }
    }
  }
}
