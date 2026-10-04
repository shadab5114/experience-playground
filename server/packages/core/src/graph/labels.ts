// Status labels shown in chat. One map, so wording changes are one-line edits.
export const LABELS = {
  route: "Understanding your request",
  find: "Finding that composition",
  gather: "Looking up VDS guidelines",
  generate: "Applying the change",
  validate: "Checking VDS rules",
  repair: "Fixing an issue",
} as const;

export type StepId = keyof typeof LABELS;
