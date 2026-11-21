/**
 * Defines the default field values and flavours used by DataFactory.
 * Add or update object configurations here without modifying DataFactory itself.
 * @see DataFactory
 */
public with sharing class DataFactoryConfig {
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

  private static DataFactory.ObjectConfig accountConfig() {
    return new DataFactory.ObjectConfig()
      .withDefaults(
        new Map<Schema.SObjectField, Object>{
          Account.Name => 'Default Account',
          Account.Type => 'Prospect',
          Account.Industry => 'Technology'
        }
      )
      .withFlavour(
        'Customer',
        new Map<Schema.SObjectField, Object>{
          Account.Type => 'Customer - Direct',
          Account.Ownership => 'Private'
        }
      )
      .withFlavour(
        'Partner',
        new Map<Schema.SObjectField, Object>{
          Account.Type => 'Channel Partner / Reseller'
        }
      );
  }

  private static DataFactory.ObjectConfig caseConfig() {
    return new DataFactory.ObjectConfig()
      .withDefaults(
        new Map<Schema.SObjectField, Object>{
          Case.Subject => 'Default Case',
          Case.Status => 'New'
        }
      );
  }
}
