import { LightningElement, api, wire } from "lwc";
import { graphql } from "lightning/graphql";
import { FIELD_LABEL_QUERY } from "./gql";

export default class ScrollableRichTextField extends LightningElement {
  @api recordId;
  @api objectApiName;
  @api fieldApiName;
  @api height;
  @api iconName;

  loading = true;
  fieldLabel;
  errors;

  // Get field label for the card header 
  @wire(graphql, {
    query: FIELD_LABEL_QUERY,
    variables: "$queryVariables"
  })
  wiredFieldLabel({ errors, data }) {
    const objectInfo = data?.uiapi?.objectInfos?.[0];
    if (objectInfo) {
      this.fieldLabel = objectInfo.fields[0].label;
    } else if (errors) {
      this.fieldLabel = this.fieldApiName;
      this.errors = errors;
    }
    this.loading = false;
  }

  get queryVariables() {
    return {
      "objectApiName": this.objectApiName,
      "fieldNames": [this.fieldApiName]
    };
  }

  renderedCallback() {
    this.setCSSVariables();
  }

  setCSSVariables() {
    const container = this.template.querySelector(".slds-scrollable_y");

    if (container) {
      container.style.setProperty(
        "--scrollable-rich-text-height",
        `${this.height}px`
      );
    }
  }
}
