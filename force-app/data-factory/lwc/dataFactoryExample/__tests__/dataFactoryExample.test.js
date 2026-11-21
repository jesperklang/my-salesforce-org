import { createElement } from "lwc";
import DataFactoryExample from "c/dataFactoryExample";
import {
  getObjectFlavours,
  getFlavourDefaults,
  insertRecord,
} from "c/dataFactoryHelper";
import DataFactoryExampleModal from "c/dataFactoryExampleModal";
import { getObjectInfo } from "lightning/uiObjectInfoApi";

jest.mock("c/dataFactoryHelper", () => ({
  getObjectFlavours: jest.fn(),
  getFlavourDefaults: jest.fn(),
  insertRecord: jest.fn(),
}));
jest.mock("c/dataFactoryExampleModal", () => ({
  __esModule: true,
  default: { open: jest.fn() },
}));

const OBJECT_FLAVOURS = [
  { objectApiName: "Account", label: "Account", flavours: ["FLAVOUR_A"] },
  { objectApiName: "Case", label: "Case", flavours: [] },
];
const FLAVOUR_DEFAULTS = [
  {
    flavour: null,
    fieldValues: {
      Name: "Base Name",
      Type: "Base Type",
      Industry: "Base Industry",
    },
  },
  {
    flavour: "FLAVOUR_A",
    fieldValues: {
      Name: "Base Name",
      Type: "Flavour Type",
      Industry: "Base Industry",
      Ownership: "Flavour Ownership",
    },
  },
];
const OBJECT_INFO = {
  label: "Account",
  fields: {
    Id: { label: "Account ID", dataType: "String" },
    Name: { label: "Account Name", dataType: "String" },
    Type: { label: "Account Type", dataType: "Picklist" },
    Industry: { label: "Industry", dataType: "Picklist" },
    Ownership: { label: "Ownership", dataType: "Picklist" },
    NumberOfEmployees: { label: "Employees", dataType: "Int" },
  },
};
const REMAINING_ADDITIONAL_FIELDS = [
  "Rating",
  "Phone",
  "Website",
  "NumberOfEmployees",
  "AnnualRevenue",
  "Description",
];
const SAVED_RECORD = {
  Id: "001000000000001AAA",
  Name: { value: "Base Name", displayValue: null },
  Type: { value: "Flavour Type", displayValue: "Flavour Type" },
  NumberOfEmployees: { value: 25, displayValue: null },
};

// eslint-disable-next-line @lwc/lwc/no-async-operation
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

async function createComponent() {
  const element = createElement("c-data-factory-example", {
    is: DataFactoryExample,
  });
  document.body.appendChild(element);
  await flushPromises();
  return element;
}

function getCombobox(element, name) {
  return [...element.shadowRoot.querySelectorAll("lightning-combobox")].find(
    (combobox) => combobox.name === name,
  );
}

async function selectObject(element, objectApiName) {
  getCombobox(element, "object").dispatchEvent(
    new CustomEvent("change", { detail: { value: objectApiName } }),
  );
  getObjectInfo.emit(OBJECT_INFO);
  await flushPromises();
}

async function selectFlavour(element, value, { valid = true } = {}) {
  getCombobox(element, "flavour").dispatchEvent(
    new CustomEvent("change", { detail: { value } }),
  );
  await flushPromises();
  getInputFields(element).forEach((input) => {
    input.reportValidity = jest.fn(() => valid);
  });
}

function getInputFields(element) {
  return [...element.shadowRoot.querySelectorAll("lightning-input-field")];
}

function getCreateButton(element) {
  return [...element.shadowRoot.querySelectorAll("lightning-button")].find(
    (button) => button.label === "Create",
  );
}

describe("c-data-factory-example", () => {
  beforeEach(() => {
    getObjectFlavours.mockResolvedValue(OBJECT_FLAVOURS);
    getFlavourDefaults.mockResolvedValue(FLAVOUR_DEFAULTS);
    insertRecord.mockResolvedValue(SAVED_RECORD);
    DataFactoryExampleModal.open.mockResolvedValue("close");
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("lists configured objects dynamically and hides flavours until an object is selected", async () => {
    const element = await createComponent();

    const objectCombobox = getCombobox(element, "object");
    expect(getObjectFlavours).toHaveBeenCalledTimes(1);
    expect(objectCombobox.options).toEqual([
      { label: "Account", value: "Account" },
      { label: "Case", value: "Case" },
    ]);
    expect(getCombobox(element, "flavour")).toBeUndefined();
    expect(getInputFields(element)).toHaveLength(0);
    expect(getCreateButton(element).disabled).toBe(true);
  });

  it("lists flavour names once an object is selected and shows no fields until a flavour is selected", async () => {
    const element = await createComponent();
    await selectObject(element, "Account");

    const flavourCombobox = getCombobox(element, "flavour");
    expect(getFlavourDefaults).toHaveBeenCalledWith("Account");
    expect(flavourCombobox.label).toBe("Flavour");
    expect(flavourCombobox.options.map(({ label }) => label)).toEqual([
      "Default",
      "FLAVOUR_A",
    ]);
    expect(getInputFields(element)).toHaveLength(0);
    expect(getCreateButton(element).disabled).toBe(true);
  });

  it("shows defaults, flavour overrides, additional flavour fields, and remaining additional fields", async () => {
    const element = await createComponent();
    await selectObject(element, "Account");
    await selectFlavour(element, "FLAVOUR_A");

    const headings = [...element.shadowRoot.querySelectorAll("h3")].map(
      (heading) => heading.textContent.trim(),
    );
    expect(headings).toEqual([
      "Data Factory Defaults",
      "Additional Flavour fields",
      "Additional fields",
    ]);

    const overrides = [...element.shadowRoot.querySelectorAll("li")].map(
      (item) => item.textContent.replace(/\s+/g, " ").trim(),
    );
    expect(overrides).toEqual(["Account Type: Base Type → Flavour Type"]);

    const inputs = getInputFields(element);
    expect(inputs.map((input) => input.fieldName)).toEqual([
      "Name",
      "Type",
      "Industry",
      "Ownership",
      ...REMAINING_ADDITIONAL_FIELDS,
    ]);
    expect(inputs[0].value).toBe("Base Name");
    expect(inputs[1].value).toBe("Flavour Type");
    expect(inputs[2].value).toBe("Base Industry");
    expect(inputs[3].value).toBe("Flavour Ownership");
    expect(getCreateButton(element).disabled).toBe(false);
  });

  it("hides overrides and additional flavour fields when base defaults are selected", async () => {
    const element = await createComponent();
    await selectObject(element, "Account");
    const [baseOption] = getCombobox(element, "flavour").options;
    await selectFlavour(element, baseOption.value);

    const headings = [...element.shadowRoot.querySelectorAll("h3")].map(
      (heading) => heading.textContent.trim(),
    );
    expect(headings).toEqual(["Data Factory Defaults", "Additional fields"]);
    expect(element.shadowRoot.querySelectorAll("li")).toHaveLength(0);
    expect(getInputFields(element).map((input) => input.fieldName)).toEqual([
      "Name",
      "Type",
      "Industry",
      ...REMAINING_ADDITIONAL_FIELDS,
    ]);
  });

  it("creates the record with the selected object and flavour and shows saved values in a modal", async () => {
    const element = await createComponent();
    await selectObject(element, "Account");
    await selectFlavour(element, "FLAVOUR_A");
    const employees = getInputFields(element).find(
      (input) => input.fieldName === "NumberOfEmployees",
    );
    employees.value = "25";

    getCreateButton(element).click();
    await flushPromises();

    const [objectApiName, fieldValues, flavour] = insertRecord.mock.calls[0];
    expect(objectApiName).toBe("Account");
    expect(flavour).toBe("FLAVOUR_A");
    expect(fieldValues.Name).toBe("Base Name");
    expect(fieldValues.Industry).toBe("Base Industry");
    expect(fieldValues.Ownership).toBe("Flavour Ownership");
    expect(fieldValues.NumberOfEmployees).toBe(25);
    expect(fieldValues).not.toHaveProperty("Rating");
    expect(DataFactoryExampleModal.open).toHaveBeenCalledWith({
      size: "small",
      label: "Account created",
      objectApiName: "Account",
      recordId: SAVED_RECORD.Id,
      fields: [
        { apiName: "Id", label: "Account ID", value: SAVED_RECORD.Id },
        { apiName: "Name", label: "Account Name", value: "Base Name" },
        { apiName: "Type", label: "Account Type", value: "Flavour Type" },
        { apiName: "NumberOfEmployees", label: "Employees", value: "25" },
      ],
    });
  });

  it("creates the record without a flavour when Default is selected", async () => {
    const element = await createComponent();
    await selectObject(element, "Account");
    const [baseOption] = getCombobox(element, "flavour").options;
    await selectFlavour(element, baseOption.value);

    getCreateButton(element).click();
    await flushPromises();

    expect(insertRecord.mock.calls[0][2]).toBeNull();
  });

  it("does not create the record when a field is invalid", async () => {
    const element = await createComponent();
    await selectObject(element, "Account");
    await selectFlavour(element, "FLAVOUR_A", { valid: false });

    getCreateButton(element).click();
    await flushPromises();

    expect(insertRecord).not.toHaveBeenCalled();
  });

  it("creates the record instead of saving through the form when it is submitted", async () => {
    const element = await createComponent();
    await selectObject(element, "Account");
    await selectFlavour(element, "FLAVOUR_A");
    const submitEvent = new CustomEvent("submit", { cancelable: true });

    element.shadowRoot
      .querySelector("lightning-record-edit-form")
      .dispatchEvent(submitEvent);
    await flushPromises();

    expect(submitEvent.defaultPrevented).toBe(true);
    expect(insertRecord).toHaveBeenCalledTimes(1);
  });

  it("shows an error toast and no modal when the record cannot be created", async () => {
    insertRecord.mockRejectedValue(new Error("Insufficient access."));
    const element = await createComponent();
    await selectObject(element, "Account");
    await selectFlavour(element, "FLAVOUR_A");
    const toastHandler = jest.fn();
    element.addEventListener("lightning__showtoast", toastHandler);

    getCreateButton(element).click();
    await flushPromises();

    expect(toastHandler).toHaveBeenCalledTimes(1);
    expect(toastHandler.mock.calls[0][0].detail).toMatchObject({
      message: "Insufficient access.",
      variant: "error",
    });
    expect(DataFactoryExampleModal.open).not.toHaveBeenCalled();
  });

  it("shows the error when configured objects cannot be loaded", async () => {
    getObjectFlavours.mockRejectedValue(new Error("Load failed."));
    const element = await createComponent();

    const error = element.shadowRoot.querySelector('[role="alert"]');
    expect(error.textContent).toBe("Load failed.");
  });
});
