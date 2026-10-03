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
