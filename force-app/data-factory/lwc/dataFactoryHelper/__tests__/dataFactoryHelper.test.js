import {
  buildCreateMutation,
  createRecord,
  getFlavourDefaults,
  getFlavours,
  getObjectFlavours,
  insertRecord,
} from "c/dataFactoryHelper";
import { executeMutation } from "lightning/graphql";
import getObjectFlavoursApex from "@salesforce/apex/DataFactoryController.getObjectFlavours";
import getFlavoursApex from "@salesforce/apex/DataFactoryController.getFlavours";
import getFlavourDefaultsApex from "@salesforce/apex/DataFactoryController.getFlavourDefaults";
import createRecordApex from "@salesforce/apex/DataFactoryController.createRecord";

// gql returns the raw query string so tests can inspect the built mutation.
jest.mock("lightning/graphql", () => ({
  gql: jest.fn((strings, ...values) => String.raw({ raw: strings }, ...values)),
  executeMutation: jest.fn(),
}));
jest.mock(
  "@salesforce/apex/DataFactoryController.getObjectFlavours",
  () => ({ default: jest.fn() }),
  { virtual: true },
);
jest.mock(
  "@salesforce/apex/DataFactoryController.getFlavours",
  () => ({ default: jest.fn() }),
  { virtual: true },
);
jest.mock(
  "@salesforce/apex/DataFactoryController.getFlavourDefaults",
  () => ({ default: jest.fn() }),
  { virtual: true },
);
jest.mock(
  "@salesforce/apex/DataFactoryController.createRecord",
  () => ({ default: jest.fn() }),
  { virtual: true },
);

describe("c-data-factory-helper", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns the configured objects with their flavours", async () => {
    const objects = [
      {
        objectApiName: "Account",
        label: "Account",
        flavours: ["CUSTOMER", "PARTNER"],
      },
      { objectApiName: "Case", label: "Case", flavours: [] },
    ];
    getObjectFlavoursApex.mockResolvedValue(objects);

    await expect(getObjectFlavours()).resolves.toEqual(objects);
  });

  it("requests the flavours of the given object", async () => {
    getFlavoursApex.mockResolvedValue(["CUSTOMER", "PARTNER"]);

    await expect(getFlavours("Account")).resolves.toEqual([
      "CUSTOMER",
      "PARTNER",
    ]);
    expect(getFlavoursApex).toHaveBeenCalledWith({ objectApiName: "Account" });
  });

  it("passes object, field values and flavour when creating a record", async () => {
    const record = { Name: "Acme", Type: "Customer - Direct" };
    createRecordApex.mockResolvedValue(record);

    await expect(
      createRecord("Account", { Name: "Acme" }, "CUSTOMER"),
    ).resolves.toEqual(record);
    expect(createRecordApex).toHaveBeenCalledWith({
      objectApiName: "Account",
      fieldValues: { Name: "Acme" },
      flavour: "CUSTOMER",
    });
  });

  it("sends empty field values and no flavour when they are omitted", async () => {
    createRecordApex.mockResolvedValue({ Subject: "Default Case" });

    await createRecord("Case");

    expect(createRecordApex).toHaveBeenCalledWith({
      objectApiName: "Case",
      fieldValues: {},
      flavour: null,
    });
  });

  it("rejects with the Apex error message", async () => {
    getFlavoursApex.mockRejectedValue({
      body: { message: 'Object "Lead" is not configured in DataFactory.' },
    });

    await expect(getFlavours("Lead")).rejects.toThrow(
      'Object "Lead" is not configured in DataFactory.',
    );
  });

  it("rejects with a fallback message when the error has none", async () => {
    createRecordApex.mockRejectedValue({});

    await expect(createRecord("Account")).rejects.toThrow("Unknown error");
  });

  it("requests the flavour defaults of the given object", async () => {
    const defaults = [
      { flavour: null, fieldValues: { Name: "Default Account" } },
    ];
    getFlavourDefaultsApex.mockResolvedValue(defaults);

    await expect(getFlavourDefaults("Account")).resolves.toEqual(defaults);
    expect(getFlavourDefaultsApex).toHaveBeenCalledWith({
      objectApiName: "Account",
    });
  });

  it("builds a create mutation that returns the given fields", () => {
    const mutation = buildCreateMutation("Account", ["Name", "Type"]);

    expect(mutation).toContain("$input: AccountCreateInput!");
    expect(mutation).toContain("AccountCreate(input: $input)");
    expect(mutation).toContain("Name { value displayValue }");
    expect(mutation).toContain("Type { value displayValue }");
  });

  describe("insertRecord", () => {
    const savedRecord = {
      Id: "001000000000001AAA",
      Name: { value: "Acme", displayValue: null },
    };

    it("saves the DataFactory record with a GraphQL mutation", async () => {
      createRecordApex.mockResolvedValue({
        attributes: { type: "Account" },
        Name: "Acme",
        Type: "Prospect",
      });
      executeMutation.mockResolvedValue({
        data: { uiapi: { AccountCreate: { Record: savedRecord } } },
      });

      await expect(
        insertRecord("Account", { Name: "Acme" }, "CUSTOMER"),
      ).resolves.toEqual(savedRecord);
      expect(createRecordApex).toHaveBeenCalledWith({
        objectApiName: "Account",
        fieldValues: { Name: "Acme" },
        flavour: "CUSTOMER",
      });
      const [mutation, { variables }] = executeMutation.mock.calls[0];
      expect(variables).toEqual({
        input: { Account: { Name: "Acme", Type: "Prospect" } },
      });
      expect(mutation).not.toContain("attributes");
    });

    it("rejects with the GraphQL error messages returned by the mutation", async () => {
      createRecordApex.mockResolvedValue({ Name: "Acme" });
      executeMutation.mockResolvedValue({
        data: null,
        errors: [{ message: "First error." }, { message: "Second error." }],
      });

      await expect(insertRecord("Account")).rejects.toThrow(
        "First error. Second error.",
      );
    });

    it("rejects with the GraphQL error messages when the mutation throws", async () => {
      createRecordApex.mockResolvedValue({ Name: "Acme" });
      executeMutation.mockRejectedValue({
        errors: [{ message: "Insufficient access." }],
      });

      await expect(insertRecord("Account")).rejects.toThrow(
        "Insufficient access.",
      );
    });

    it("does not run the mutation when DataFactory fails", async () => {
      createRecordApex.mockRejectedValue({
        body: { message: 'Unknown flavour "VIP" for Account.' },
      });

      await expect(insertRecord("Account", {}, "VIP")).rejects.toThrow(
        'Unknown flavour "VIP" for Account.',
      );
      expect(executeMutation).not.toHaveBeenCalled();
    });
  });
});
