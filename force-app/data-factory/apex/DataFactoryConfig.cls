/**
 * Defines the default field values and flavours used by DataFactory.
 * Add or update object configurations here without modifying DataFactory itself.
 * @see DataFactory
 */
public with sharing class DataFactoryConfig {
  private static final Map<Schema.SObjectType, Map<String, Schema.RecordTypeInfo>> RECORD_TYPES_BY_OBJECT = new Map<Schema.SObjectType, Map<String, Schema.RecordTypeInfo>>();

  /**
   * Builds the map of configured SObject types to their defaults and flavours.
   * @return Object configurations keyed by SObjectType.
   */
  public static Map<Schema.SObjectType, DataFactory.ObjectConfig> getConfig() {
    return new Map<Schema.SObjectType, DataFactory.ObjectConfig>{
      Account.SObjectType => accountConfig(),
      Case.SObjectType => caseConfig()
    };
  }

  // ACCOUNT
  private static DataFactory.ObjectConfig accountConfig() {
    return new DataFactory.ObjectConfig()
      .withDefaults(
        new Map<Schema.SObjectField, Object>{
          Account.Name => 'Default Account {0}',
          Account.Type => 'Prospect',
          Account.Industry => 'Technology'
        }
      )
      .withFlavour(
        'Customer',
        new Map<Schema.SObjectField, Object>{
          Account.Type => 'Customer - Direct',
          Account.Ownership => 'Private',
          Account.RecordTypeId => getRecordTypeId(
            Account.SObjectType,
            'Customer'
          )
        }
      )
      .withFlavour(
        'Partner',
        new Map<Schema.SObjectField, Object>{
          Account.Type => 'Channel Partner / Reseller',
          Account.RecordTypeId => getRecordTypeId(
            Account.SObjectType,
            'Partner'
          )
        }
      );
  }

  // CASE
  private static DataFactory.ObjectConfig caseConfig() {
    return new DataFactory.ObjectConfig()
      .withDefaults(
        new Map<Schema.SObjectField, Object>{
          Case.Subject => 'Default Case',
          Case.Status => 'New'
        }
      );
  }

  private static Id getRecordTypeId(
    Schema.SObjectType objectType,
    String developerName
  ) {
    if (!RECORD_TYPES_BY_OBJECT.containsKey(objectType)) {
      RECORD_TYPES_BY_OBJECT.put(
        objectType,
        objectType.getDescribe().getRecordTypeInfosByDeveloperName()
      );
    }
    Schema.RecordTypeInfo info = RECORD_TYPES_BY_OBJECT.get(objectType)
      .get(developerName);
    if (info == null) {
      throw new DataFactory.DataFactoryException(
        'Unknown RecordType "' +
          developerName +
          '" on ' +
          objectType.getDescribe().getName() +
          '.'
      );
    }
    return info.getRecordTypeId();
  }
}
