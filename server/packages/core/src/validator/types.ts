import type { CatalogSource } from "../ports";

export type DocumentKind = "composition" | "page";

export interface ValidationError {
  severity: "error" | "warning";
  layer: "envelope" | "catalog" | "structure" | "rules" | "scope" | "bindings";
  code: string;
  componentId?: string;
  path: string;
  message: string;
  hint?: string;
}

export interface ValidationContext {
  kind: DocumentKind;
  catalog: CatalogSource;
  // The document the user currently sees. When given, scope checks compare against it.
  current?: unknown;
}
