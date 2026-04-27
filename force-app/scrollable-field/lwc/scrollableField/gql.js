import { gql } from "lightning/graphql";

export const FIELD_LABEL_QUERY = gql`
  query ScrollableRichTextFieldFieldLabel(
    $objectApiName: String!
    $fieldNames: [String!]
  ) {
    uiapi {
      objectInfos(
        objectInfoInputs: [{ apiName: $objectApiName, fieldNames: $fieldNames }]
      ) {
        fields {
          label
        }
      }
    }
  }
`;