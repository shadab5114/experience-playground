import type { Operation } from 'fast-json-patch'

export interface MockScenarioStep {
  label: string
  /** Roughly how long this step's spinner runs before turning into a check. */
  ms: number
}

export type MockScenarioOutcome =
  | { kind: 'edit'; patch: Operation[]; summary: string; message: string }
  | { kind: 'refusal'; reason: string; alternatives: string[] }
  | { kind: 'scope'; message: string }

export interface MockScenario {
  id: string
  /** Which experiences this scenario applies to. */
  experienceIds: string[]
  /** Case-insensitive regex patterns tested against the prompt. First match wins. */
  match: string[]
  steps: MockScenarioStep[]
  outcome: MockScenarioOutcome
}

export interface VdsCapColorRule {
  /** The real `BadgeBackgroundColor` token from pds-core. */
  token: string
  /** Designer-facing display name, used in refusal alternatives. */
  name: string
}

export interface VdsRules {
  capColors: VdsCapColorRule[]
}
