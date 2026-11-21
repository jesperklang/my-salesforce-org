import { createElement } from "lwc";
import DataFactoryExampleModal from "c/dataFactoryExampleModal";

const mockClose = jest.fn();
const mockNavigate = jest.fn();

// lightning/modal has no sfdx-lwc-jest stub.
jest.mock(
  "lightning/modal",
  () => {
    const { LightningElement } = require("lwc");
    return {
      __esModule: true,
      default: class LightningModal extends LightningElement {
        close(result) {
          mockClose(result);
        }
      },
    };
  },
  { virtual: true },
);
jest.mock("lightning/navigation", () => {
  const Navigate = Symbol("Navigate");
  const NavigationMixin = (Base) =>
    class extends Base {
      [Navigate](pageReference) {
        mockNavigate(pageReference);
      }
    };
  NavigationMixin.Navigate = Navigate;
  return { NavigationMixin };
});

const RECORD_ID = "001000000000001AAA";
const FIELDS = [
  { apiName: "Id", label: "Account ID", value: RECORD_ID },
  { apiName: "Name", label: "Account Name", value: "Acme" },
];

function createComponent() {
  const element = createElement("c-data-factory-example-modal", {
    is: DataFactoryExampleModal,
  });
  element.objectApiName = "Account";
  element.recordId = RECORD_ID;
  element.fields = FIELDS;
  document.body.appendChild(element);
  return element;
}

function clickButton(element, label) {
  [...element.shadowRoot.querySelectorAll("lightning-button")]
    .find((button) => button.label === label)
    .click();
}

describe("c-data-factory-example-modal", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("shows the label and value of each saved field", () => {
    const element = createComponent();

    const items = [
      ...element.shadowRoot.querySelectorAll('[role="listitem"]'),
    ].map((item) => [
      item.querySelector(".slds-form-element__label").textContent,
      item.querySelector(".slds-form-element__static").textContent,
    ]);
    expect(items).toEqual([
      ["Account ID", RECORD_ID],
      ["Account Name", "Acme"],
    ]);
  });

  it("navigates to the record and closes when View Record is clicked", () => {
    const element = createComponent();

    clickButton(element, "View Record");

    expect(mockNavigate).toHaveBeenCalledWith({
      type: "standard__recordPage",
      attributes: {
        recordId: RECORD_ID,
        objectApiName: "Account",
        actionName: "view",
      },
    });
    expect(mockClose).toHaveBeenCalledWith("view");
  });

  it("closes without navigating when Close is clicked", () => {
    const element = createComponent();

    clickButton(element, "Close");

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledWith("close");
  });
});
