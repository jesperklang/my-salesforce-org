/**
 * Provides the 'Flavour' picklist values of the 'Build Record with Data Factory' Flow action:
 * "[Object]: Default" and "[Object]: [Flavour]" for each object configured in DataFactory.
 * Referenced from the DataFactory InvocableActionExtension; global like the platform's
 * dynamic picklist examples, since the platform instantiates it.
 * @see DataFactoryFlowCreate.createFromFlow
 */
global with sharing class DataFactoryFlowFlavourPicklist extends VisualEditor.DynamicPickList {
  /**
   * No default, so the flavour has to be chosen explicitly.
   * @return Always null.
   */
  global override VisualEditor.DataRow getDefaultValue() {
    return null;
  }

  /**
   * Lists the Flavour options of every configured object.
   * @return One row per Flavour option, with the same label and value.
   */
  global override VisualEditor.DynamicPickListRows getValues() {
    VisualEditor.DynamicPickListRows rows = new VisualEditor.DynamicPickListRows();
    for (String option : DataFactoryFlowCreate.getFlowFlavourOptions()) {
      rows.addRow(new VisualEditor.DataRow(option, option));
    }
    return rows;
  }
}
