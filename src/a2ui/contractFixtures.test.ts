import { describe, expect, test } from 'vitest'
import { A2UIDocumentSchema } from '@experience-agent/contract'

// Every mock composition and page fixture must fit the shared A2UI contract.
// If one doesn't, fix the fixture, not the contract.
const fixtures = import.meta.glob<{ default: { id: string; a2ui: unknown } }>(
  '../mocks/{compositions,pages}/*.json',
  { eager: true },
)

describe('mock fixtures fit the shared A2UI contract', () => {
  test('there are fixtures to check', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThan(0)
  })

  for (const [path, mod] of Object.entries(fixtures)) {
    test(`${path} parses`, () => {
      const result = A2UIDocumentSchema.safeParse(mod.default.a2ui)
      expect(result.success, JSON.stringify(result.error?.issues?.slice(0, 3))).toBe(true)
    })
  }
})

/**
 * The same six documents exist twice on purpose: `src/mocks/` so mock mode runs
 * with no backend, and `server/ds-packs/vds/seed/` so remote mode starts from
 * the same content. Nothing imports across that boundary — the playground must
 * not depend on a ds-pack — so this test is what keeps the two copies equal.
 *
 * If it fails, one side was edited and the other was not. Decide which document
 * is right and copy it over; do not relax the test. (A deliberate divergence
 * between mock and remote content would mean changing this test on purpose.)
 */
const seeds = import.meta.glob<{ default: { id: string; a2ui: unknown }[] }>(
  '../../server/ds-packs/vds/seed/{compositions,page-templates}.json',
  { eager: true },
)

describe('mock fixtures match the backend seed', () => {
  const cases = [
    { dir: 'compositions', seedFile: 'compositions.json' },
    { dir: 'pages', seedFile: 'page-templates.json' },
  ]

  for (const { dir, seedFile } of cases) {
    const seeded_ = seeds[`../../server/ds-packs/vds/seed/${seedFile}`]
    test(`the ${seedFile} seed file was found and is not empty`, () => {
      expect(seeded_?.default.length, `no seed file ${seedFile}`).toBeGreaterThan(0)
    })
    for (const seeded of seeded_?.default ?? []) {
      test(`${dir}/${seeded.id}`, () => {
        const mock = fixtures[`../mocks/${dir}/${seeded.id}.json`]
        expect(mock, `no mock fixture for seeded ${dir} ${seeded.id}`).toBeDefined()
        expect(mock.default.a2ui).toEqual(seeded.a2ui)
      })
    }
  }
})
