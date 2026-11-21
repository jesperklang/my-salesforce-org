import { api } from "lwc";
import LightningModal from "lightning/modal";
import { NavigationMixin } from "lightning/navigation";

export default class DataFactoryExampleModal extends NavigationMixin(
  LightningModal,
) {
  @api objectApiName;
  @api recordId;
  /** @type {Array<{apiName: string, label: string, value: string}>} */
  @api fields = [];

  handleViewRecord() {
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: {
        recordId: this.recordId,
        objectApiName: this.objectApiName,
        actionName: "view",
      },
    });
    this.close("view");
  }

  handleClose() {
    this.close("close");
  }
}
