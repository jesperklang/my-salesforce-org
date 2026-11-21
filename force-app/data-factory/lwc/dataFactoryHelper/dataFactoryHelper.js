import { gql, executeMutation } from "lightning/graphql";
import getObjectFlavoursApex from "@salesforce/apex/DataFactoryController.getObjectFlavours";
import getFlavoursApex from "@salesforce/apex/DataFactoryController.getFlavours";
import getFlavourDefaultsApex from "@salesforce/apex/DataFactoryController.getFlavourDefaults";
import createRecordApex from "@salesforce/apex/DataFactoryController.createRecord";

const UNKNOWN_ERROR = "Unknown error";
const NON_INPUT_FIELDS = new Set(["Id", "attributes"]);

/**
 * Lists the objects configured in DataFactory with their flavours.
 * @returns {Promise<Array<{objectApiName: string, label: string, flavours: string[]}>>}
 */
export function getObjectFlavours() {
  return callApex(getObjectFlavoursApex);
}

/**
 * Lists the flavours of a configured object.
 * @param {string} objectApiName API name of a configured object.
 * @returns {Promise<string[]>}
 */
export function getFlavours(objectApiName) {
  return callApex(getFlavoursApex, { objectApiName });
}

/**
 * Lists the configured field values of an object: the base defaults (flavour null) first,
 * then each flavour with its values merged over the defaults.
 * @param {string} objectApiName API name of a configured object.
 * @returns {Promise<Array<{flavour: ?string, fieldValues: Object<string, *>}>>}
 */
export function getFlavourDefaults(objectApiName) {
  return callApex(getFlavourDefaultsApex, { objectApiName });
}

/**
 * Builds a GraphQL mutation that creates a record and returns the given fields.
 * @param {string} objectApiName Exact API name of the object, e.g. "Account".
 * @param {string[]} fieldApiNames Fields to return as { value, displayValue }.
 * @returns {Object} Parsed mutation; pass the record values as the `input` variable.
 */
export function buildCreateMutation(objectApiName, fieldApiNames = []) {
  const fieldSelection = fieldApiNames
    .map((fieldApiName) => `${fieldApiName} { value displayValue }`)
    .join("\n");
  return gql`
    mutation DataFactoryCreate${objectApiName}($input: ${objectApiName}CreateInput!) {
      uiapi {
        ${objectApiName}Create(input: $input) {
          Record {
            Id
            ${fieldSelection}
          }
        }
      }
    }
  `;
}

/**
 * Builds a record with DataFactory (defaults, flavour, then field values) and saves it
 * with a GraphQL mutation as the current user.
 * @param {string} objectApiName Exact API name of a configured object, e.g. "Account".
 * @param {Object<string, *>} [fieldValues] Field values by field API name.
 * @param {string} [flavour] Flavour name; omit for base defaults only.
 * @returns {Promise<Object>} The saved record: `Id` plus `{ value, displayValue }` per saved field.
 */
export async function insertRecord(
  objectApiName,
  fieldValues = {},
  flavour = null,
) {
  const record = await createRecord(objectApiName, fieldValues, flavour);
  const canonicalObjectApiName = record.attributes?.type ?? objectApiName;
  const input = Object.fromEntries(
    Object.entries(record).filter(([field]) => !NON_INPUT_FIELDS.has(field)),
  );

  let result;
  try {
    result = await executeMutation(
      buildCreateMutation(canonicalObjectApiName, Object.keys(input)),
      { variables: { input: { [canonicalObjectApiName]: input } } },
    );
  } catch (error) {
    throw new Error(
      getGraphQLErrorMessage(error?.errors) ?? getErrorMessage(error),
    );
  }

  const savedRecord =
    result?.data?.uiapi?.[`${canonicalObjectApiName}Create`]?.Record;
  if (result?.errors?.length || !savedRecord) {
    throw new Error(getGraphQLErrorMessage(result?.errors) ?? UNKNOWN_ERROR);
  }
  return savedRecord;
}

/**
 * Builds an unsaved record with DataFactory defaults, flavour and field values applied.
 * @param {string} objectApiName API name of a configured object.
 * @param {Object<string, *>} [fieldValues] Field values by field API name.
 * @param {string} [flavour] Flavour name; omit for base defaults only.
 * @returns {Promise<Object>} The unsaved record.
 */
export function createRecord(objectApiName, fieldValues = {}, flavour = null) {
  return callApex(createRecordApex, { objectApiName, fieldValues, flavour });
}

// Rejects with a plain Error so callers don't need to unpack Apex error bodies.
async function callApex(apexMethod, params) {
  try {
    return await apexMethod(params);
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}

function getErrorMessage(error) {
  return error?.body?.message || error?.message || UNKNOWN_ERROR;
}

function getGraphQLErrorMessage(errors) {
  const messages = Array.isArray(errors)
    ? errors.map((error) => error?.message).filter(Boolean)
    : [];
  return messages.length ? messages.join(" ") : null;
}
