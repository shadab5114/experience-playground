// Reads an A2UI v0.9 document into the pieces every layer needs. Plain code,
// defensive about malformed input: a layer reports a problem, it never throws.
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export interface Comp {
  path: string;
  raw: Record<string, unknown>; // {} when the entry is not an object
  id: string | undefined;
  component: string | undefined;
}

export interface Model {
  createSurface: { surfaceId: string | undefined; catalogId: string | undefined } | undefined;
  messageList: { path: string; value: unknown }[];
  comps: Comp[];
  byId: Map<string, Comp>; // first occurrence of each id
  dataModel: unknown;
  hasDataModel: boolean;
  repeated: Set<string>; // ids rendered once per item of a list template
}

function unescapePointer(part: string): string {
  return part.replace(/~1/g, "/").replace(/~0/g, "~");
}

function setAt(node: unknown, keys: string[], value: unknown): unknown {
  if (keys.length === 0) return value;
  const [head, ...rest] = keys as [string, ...string[]];
  const container: Record<string, unknown> = isObj(node) ? { ...node } : {};
  container[head] = setAt(container[head], rest, value);
  return container;
}

// Resolves a JSON pointer. "/" and "" mean the whole model. A path without a
// leading slash is resolved from the root too (the caller decides the context).
export function resolvePointer(model: unknown, path: string): { found: boolean; value: unknown } {
  if (path === "" || path === "/") return { found: model !== undefined, value: model };
  let node: unknown = model;
  for (const raw of path.replace(/^\//, "").split("/")) {
    const key = unescapePointer(raw);
    if (Array.isArray(node) && /^\d+$/.test(key) && Number(key) < node.length) {
      node = node[Number(key)];
    } else if (isObj(node) && Object.prototype.hasOwnProperty.call(node, key)) {
      node = node[key];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: node };
}

// Every binding path under a value. A binding is an object whose keys are only
// "path" (and "componentId" for a list template).
export function bindingPaths(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) bindingPaths(v, out);
  } else if (isObj(value)) {
    const keys = Object.keys(value);
    if (typeof value.path === "string" && keys.every((k) => k === "path" || k === "componentId")) {
      out.push(value.path);
    } else {
      for (const k of keys) bindingPaths(value[k], out);
    }
  }
  return out;
}

// Ids a component refers to as children. hard = must exist; soft = a string
// `children` counts only if it names a component, otherwise it is text.
export function refsOf(raw: Record<string, unknown>): { hard: string[]; soft: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];
  if (typeof raw.child === "string") hard.push(raw.child);
  const ch = raw.children;
  if (Array.isArray(ch)) {
    for (const v of ch) {
      if (typeof v === "string") hard.push(v);
      else if (isObj(v) && typeof v.id === "string") hard.push(v.id);
    }
  } else if (isObj(ch) && typeof ch.componentId === "string") {
    hard.push(ch.componentId);
  } else if (typeof ch === "string") {
    soft.push(ch);
  }
  return { hard, soft };
}

export function buildModel(doc: unknown): Model {
  const messages = isObj(doc) && Array.isArray(doc.a2ui) ? doc.a2ui : [];
  let createSurface: Model["createSurface"];
  const comps: Comp[] = [];
  let dataModel: unknown;
  let hasDataModel = false;

  const messageList = messages.map((value, i) => ({ path: `a2ui[${i}]`, value }));

  messages.forEach((m, i) => {
    if (!isObj(m)) return;
    if (isObj(m.createSurface) && createSurface === undefined) {
      const s = m.createSurface;
      createSurface = {
        surfaceId: typeof s.surfaceId === "string" ? s.surfaceId : undefined,
        catalogId: typeof s.catalogId === "string" ? s.catalogId : undefined,
      };
    }
    if (isObj(m.updateDataModel)) {
      const u = m.updateDataModel;
      const keys = typeof u.path === "string" && u.path !== "/" ? u.path.replace(/^\//, "").split("/").map(unescapePointer) : [];
      dataModel = setAt(dataModel, keys, u.value);
      hasDataModel = true;
    }
    if (isObj(m.updateComponents) && Array.isArray(m.updateComponents.components)) {
      m.updateComponents.components.forEach((c, j) => {
        const raw = isObj(c) ? c : {};
        comps.push({
          path: `a2ui[${i}].updateComponents.components[${j}]`,
          raw,
          id: typeof raw.id === "string" ? raw.id : undefined,
          component: typeof raw.component === "string" ? raw.component : undefined,
        });
      });
    }
  });

  const byId = new Map<string, Comp>();
  for (const c of comps) if (c.id !== undefined && !byId.has(c.id)) byId.set(c.id, c);

  const model: Model = { createSurface, messageList, comps, byId, dataModel, hasDataModel, repeated: new Set() };
  model.repeated = computeRepeated(model);
  return model;
}

// Components reachable from root through a list template. These render once per item.
function computeRepeated(model: Model): Set<string> {
  const repeated = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string, inside: boolean): void => {
    const comp = model.byId.get(id);
    if (!comp) return;
    if (inside) repeated.add(id);
    const key = `${id}|${inside}`;
    if (visited.has(key)) return;
    visited.add(key);

    const ch = comp.raw.children;
    if (isObj(ch) && typeof ch.componentId === "string") visit(ch.componentId, true);
    const { hard } = refsOf(comp.raw);
    if (!(isObj(ch) && typeof ch.componentId === "string")) {
      for (const ref of hard) visit(ref, inside);
    }
  };

  if (model.byId.has("root")) visit("root", false);
  return repeated;
}
