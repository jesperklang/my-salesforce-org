import { LightningElement, wire } from "lwc";
import { getObjectInfo } from "lightning/uiObjectInfoApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import {
  getObjectFlavours,
  getFlavourDefaults,
  insertRecord,
} from "c/dataFactoryHelper";
import DataFactoryExampleModal from "c/dataFactoryExampleModal";

const ADDITIONAL_FIELDS_BY_OBJECT = {
  Account: [
    "Industry",
    "Rating",
    "Phone",
    "Website",
    "NumberOfEmployees",
    "AnnualRevenue",
    "Description",
  ],
  Case: ["Origin", "Priority", "Description"],
};
// Combobox values must be non-empty, so the base defaults (no flavour) get a placeholder value.
const BASE_FLAVOUR = "__BASE__";
const NUMERIC_TYPES = new Set(["Currency", "Double", "Int", "Percent"]);

export default class DataFactoryExample extends LightningElement {
  configuredObjects = [];
  selectedObjectApiName;
  flavourDefaults = [];
  selectedFlavour;
  errorMessage;
  isLoading = true;
  isSaving = false;

  @wire(getObjectInfo, { objectApiName: "$selectedObjectApiName" })
  objectInfo;

  connectedCallback() {
    this.loadObjects();
  }

  async loadObjects() {
    this.isLoading = true;
    this.errorMessage = undefined;
    try {
      this.configuredObjects = await getObjectFlavours();
    } catch (error) {
      this.errorMessage = error.message;
    } finally {
      this.isLoading = false;
    }
  }

  async loadFlavourDefaults(objectApiName) {
    this.isLoading = true;
    this.errorMessage = undefined;
    try {
      const defaults = await getFlavourDefaults(objectApiName);
      if (this.selectedObjectApiName !== objectApiName) {
        return;
      }
      this.flavourDefaults = defaults;
    } catch (error) {
      if (this.selectedObjectApiName !== objectApiName) {
        return;
      }
      this.flavourDefaults = [];
      this.errorMessage = error.message;
    } finally {
      if (this.selectedObjectApiName === objectApiName) {
        this.isLoading = false;
      }
    }
  }

  get objectOptions() {
    return this.configuredObjects.map(({ objectApiName, label }) => ({
      label,
      value: objectApiName,
    }));
  }

  get flavourOptions() {
    return this.flavourDefaults.map(({ flavour }) => ({
      label: flavour ?? "Default",
      value: flavour ?? BASE_FLAVOUR,
    }));
  }

  get baseFieldValues() {
    const base = this.flavourDefaults.find(({ flavour }) => flavour === null);
    return base?.fieldValues ?? {};
  }

  get selectedFieldValues() {
    const selected = this.flavourDefaults.find(
      ({ flavour }) => (flavour ?? BASE_FLAVOUR) === this.selectedFlavour,
    );
    return selected?.fieldValues ?? {};
  }

  // Keys include object and flavour so inputs are recreated, and reset, on selection change.
  get defaultFields() {
    const selected = this.selectedFieldValues;
    return Object.keys(this.baseFieldValues).map((apiName) =>
      this.toInputField(apiName, selected[apiName]),
    );
  }

  get overriddenDefaults() {
    if (this.selectedFlavour === BASE_FLAVOUR) {
      return [];
    }
    const selected = this.selectedFieldValues;
    return Object.entries(this.baseFieldValues)
      .filter(([apiName, baseValue]) => selected[apiName] !== baseValue)
      .map(([apiName, baseValue]) => ({
        apiName,
        label: this.getFieldLabel(apiName),
        fromValue: this.toDisplayString(baseValue),
        toValue: this.toDisplayString(selected[apiName]),
      }));
  }

  get flavourFields() {
    const base = this.baseFieldValues;
    return Object.entries(this.selectedFieldValues)
      .filter(([apiName]) => !(apiName in base))
      .map(([apiName, value]) => this.toInputField(apiName, value));
  }

  get additionalFields() {
    const configured = this.selectedFieldValues;
    const fields =
      ADDITIONAL_FIELDS_BY_OBJECT[this.selectedObjectApiName] ?? [];
    return fields
      .filter((apiName) => !(apiName in configured))
      .map((apiName) => this.toInputField(apiName, null));
  }

  get hasDefaultFields() {
    return this.defaultFields.length > 0;
  }

  get hasOverriddenDefaults() {
    return this.overriddenDefaults.length > 0;
  }

  get hasFlavourFields() {
    return this.flavourFields.length > 0;
  }

  get hasAdditionalFields() {
    return this.additionalFields.length > 0;
  }

  get isBusy() {
    return this.isLoading || this.isSaving;
  }

  get spinnerText() {
    return this.isSaving ? "Creating record" : "Loading";
  }

  get isCreateDisabled() {
    return !this.selectedObjectApiName || !this.selectedFlavour || this.isBusy;
  }

  handleObjectChange(event) {
    this.selectedObjectApiName = event.detail.value;
    this.selectedFlavour = undefined;
    this.flavourDefaults = [];
    this.loadFlavourDefaults(this.selectedObjectApiName);
  }

  handleFlavourChange(event) {
    this.selectedFlavour = event.detail.value;
  }

  // Stops the record edit form from saving through LDS when Enter is pressed.
  handleSubmit(event) {
    event.preventDefault();
    this.handleCreate();
  }

  async handleCreate() {
    if (this.isCreateDisabled) {
      return;
    }

    const inputs = [...this.template.querySelectorAll("lightning-input-field")];
    const isValid = inputs.reduce(
      (valid, input) => input.reportValidity() && valid,
      true,
    );
    if (!isValid) {
      return;
    }

    const configuredFields = this.selectedFieldValues;
    const fieldValues = Object.fromEntries(
      inputs
        .map((input) => [
          input.fieldName,
          this.normalizeValue(input.fieldName, input.value),
        ])
        .filter(
          ([apiName, value]) => value !== null || apiName in configuredFields,
        ),
    );
    const flavour =
      this.selectedFlavour === BASE_FLAVOUR ? null : this.selectedFlavour;

    this.isSaving = true;
    try {
      const record = await insertRecord(
        this.selectedObjectApiName,
        fieldValues,
        flavour,
      );
      await DataFactoryExampleModal.open({
        size: "small",
        label: `${this.objectInfo.data?.label ?? this.selectedObjectApiName} created`,
        objectApiName: this.selectedObjectApiName,
        recordId: record.Id,
        fields: this.toSavedFields(record),
      });
    } catch (error) {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Record could not be created",
          message: error.message,
          variant: "error",
        }),
      );
    } finally {
      this.isSaving = false;
    }
  }

  toInputField(apiName, value) {
    return {
      key: `${this.selectedObjectApiName}-${this.selectedFlavour}-${apiName}`,
      apiName,
      value,
    };
  }

  toSavedFields(record) {
    const fields = [
      { apiName: "Id", label: this.getFieldLabel("Id"), value: record.Id },
    ];
    Object.entries(record)
      .filter(([apiName]) => apiName !== "Id")
      .forEach(([apiName, field]) => {
        fields.push({
          apiName,
          label: this.getFieldLabel(apiName),
          value: field?.displayValue ?? this.toDisplayString(field?.value),
        });
      });
    return fields;
  }

  normalizeValue(apiName, value) {
    if (value === undefined || value === "") {
      return null;
    }
    const dataType = this.objectInfo.data?.fields?.[apiName]?.dataType;
    return NUMERIC_TYPES.has(dataType) && value !== null
      ? Number(value)
      : value;
  }

  toDisplayString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  getFieldLabel(apiName) {
    return this.objectInfo.data?.fields?.[apiName]?.label ?? apiName;
  }
}
