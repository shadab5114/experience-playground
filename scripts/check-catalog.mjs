#!/usr/bin/env node
/**
 * Day-0 feasibility check for porting this app to another component library.
 *
 *   node scripts/check-catalog.mjs [package-name]
 *
 * Defaults to the package this repo currently uses. Point it at your own
 * library *before* changing any code: it answers the only question that decides
 * whether the port is a day or a project — does the library ship the four
 * artifacts the renderer, the validator and the agent all need?
 *
 * Exits non-zero if anything required is missing. See docs/PORTING.md.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkgName = process.argv[2] ?? '@shadab5114/pds-core'

// A2UI's canonical $defs. The renderer branches on these literal $ref strings
// (src/a2ui/schema.ts); rename one in your catalog and bindings stop resolving
// with no error at all — a raw { path } object is handed to React as a prop.
const CANONICAL_DEFS = ['DynamicString', 'DynamicBoolean', 'ChildList', 'IconName', 'ComponentCommon', 'Action']

const problems = []
const notes = []
const fail = (msg) => problems.push(msg)
const note = (msg) => notes.push(msg)

const load = async (subpath, label) => {
  try {
    return await import(subpath ? `${pkgName}/${subpath}` : pkgName)
  } catch (err) {
    fail(`${label} (${subpath ? `${pkgName}/${subpath}` : pkgName}) could not be loaded: ${err.code ?? err.message}`)
    return undefined
  }
}

// ---- 1. catalog.json -------------------------------------------------------
let catalog
try {
  catalog = require(`${pkgName}/catalog.json`)
} catch (err) {
  fail(`no ${pkgName}/catalog.json (${err.code ?? err.message}). Everything else depends on this.`)
}

let componentNames = []
if (catalog) {
  if (typeof catalog.catalogId !== 'string' || catalog.catalogId === '') {
    fail('catalog.json has no `catalogId`. This is the value that goes in pack.json; do not invent one.')
  } else {
    note(`catalogId: ${catalog.catalogId}`)
  }

  if (!catalog.components || typeof catalog.components !== 'object') {
    fail('catalog.json has no `components` map.')
  } else {
    componentNames = Object.keys(catalog.components)
    note(`components: ${componentNames.length}`)
  }

  const defs = catalog.$defs ?? {}
  const missingDefs = CANONICAL_DEFS.filter((d) => !(d in defs))
  if (missingDefs.length > 0) {
    fail(
      `catalog.json $defs is missing the canonical A2UI names: ${missingDefs.join(', ')}. ` +
        'The renderer compares literal "#/$defs/<Name>" strings, so a renamed def fails SILENTLY.',
    )
  }

  // unevaluatedProperties: false is what makes a misnamed prop a validation
  // error instead of a prop React quietly ignores.
  const strict = componentNames.filter((n) => {
    const parts = [catalog.components[n], ...(catalog.components[n]?.allOf ?? [])]
    return parts.some((p) => p?.unevaluatedProperties === false)
  })
  if (componentNames.length > 0 && strict.length === 0) {
    note('no component entry sets `unevaluatedProperties: false` — misnamed props will not be caught by validation')
  }
}

// ---- 2. Zod schema exports (the server throws at startup without these) ----
const schemas = await load('schemas', 'the Zod schema entrypoint')
if (schemas && componentNames.length > 0) {
  const missing = componentNames.filter((n) => schemas[`${n}Schema`] === undefined)
  if (missing.length > 0) {
    fail(
      `${missing.length} catalog component(s) have no \`<Name>Schema\` export: ${missing.slice(0, 12).join(', ')}` +
        `${missing.length > 12 ? ', …' : ''}. createVdsCatalog() throws at startup on the first one.`,
    )
  } else {
    note(`Zod schemas: all ${componentNames.length} present`)
  }
}

// ---- 3. Named React component exports from the package root ---------------
const root = await load('', 'the package root')
if (root && componentNames.length > 0) {
  const missing = componentNames.filter((n) => root[n] === undefined)
  if (missing.length > 0) {
    fail(
      `${missing.length} catalog component(s) are not exported from the package root: ` +
        `${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}. ` +
        'Each renders as the "Unsupported component" box.',
    )
  } else {
    note(`root exports: all ${componentNames.length} resolve`)
  }
}

// ---- 4. Icons (optional, but the renderer bridges IconName through it) ----
const usesIconName = catalog ? JSON.stringify(catalog).includes('#/$defs/IconName') : false
if (usesIconName) {
  const icons = await load('icons', 'the icons entrypoint')
  if (icons) note(`icons: ${Object.keys(icons).length} exports`)
} else {
  note('no component uses #/$defs/IconName — src/a2ui/renderer/icons.tsx may not be needed')
}

// ---- Report ---------------------------------------------------------------
console.log(`\ncatalog preflight: ${pkgName}\n`)
for (const n of notes) console.log(`  ·  ${n}`)
if (problems.length === 0) {
  console.log('\n  PASS — this library ships what the port needs.\n')
  process.exit(0)
}
console.log('')
for (const p of problems) console.log(`  !  ${p}`)
console.log(
  `\n  FAIL — ${problems.length} blocker(s). Generating the missing artifacts is the bulk of the port;` +
    ' see docs/PORTING.md section 2.\n',
)
process.exit(1)
