// Facts read straight out of an A2UI document. Both are things a caller must
// never be asked for and must never be trusted to supply: meta.components can
// be absent or stale, and a page's slot list can drift from the Slot nodes the
// document actually declares. Derive, don't ask.
import type { A2UIComponentNode, A2UIDocument } from "@experience-agent/contract";

function componentNodes(doc: A2UIDocument): A2UIComponentNode[] {
  return doc.a2ui.flatMap((msg) => ("updateComponents" in msg ? msg.updateComponents.components : []));
}

// Component names in a document, from its updateComponents messages.
export function documentComponents(doc: A2UIDocument): string[] {
  return [...new Set(componentNodes(doc).map((c) => c.component))];
}

// Slot ids a page document declares. "Slot" is a pack extra, allowed only in
// pages; a composition has none.
export function documentSlots(doc: A2UIDocument): string[] {
  const ids = componentNodes(doc)
    .filter((node) => node.component === "Slot" && typeof node.slotId === "string")
    .map((node) => node.slotId as string);
  return [...new Set(ids)];
}
