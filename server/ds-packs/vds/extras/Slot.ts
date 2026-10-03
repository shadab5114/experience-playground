// Slot: a placeholder in a page template where a composition is hosted.
// Playground-native, not in the pds catalog. Allowed only in pages.
import { z } from "zod";

export const SlotExtra = {
  component: "Slot",
  allowedIn: "page",
  props: z.object({
    slotId: z.string().min(1),
  }),
} as const;
