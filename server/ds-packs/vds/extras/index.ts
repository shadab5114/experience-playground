// Every component the pack registers outside the pds catalog. Adding one:
// write its schema in this folder, add it to the list below, add its renderer
// entry in the playground, and add a passing and a failing fixture.
import { SlotExtra } from "./Slot";

export const extras = [SlotExtra] as const;
