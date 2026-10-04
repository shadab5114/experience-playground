// The one place that picks mock or remote services. The task store imports
// `services` and never constructs a repository or agent client itself.
import { API_BASE_URL, DATA_SOURCE, type DataSource } from './config'
import type { AgentClient } from './agent/AgentClient'
import { MockAgentClient } from './agent/MockAgentClient'
import { RemoteAgentClient } from './agent/RemoteAgentClient'
import type { Repository } from './repository/Repository'
import type { AuthoringRepository } from './repository/AuthoringRepository'
import { MockRepository } from './repository/MockRepository'
import { RemoteRepository } from './repository/RemoteRepository'
import { RemoteAuthoringRepository } from './repository/RemoteAuthoringRepository'

export interface Services {
  repository: Repository
  agentClient: AgentClient
  /**
   * `null` in mock mode: authoring writes to Postgres, which has no mock
   * equivalent, so the Studio is hidden rather than faked.
   */
  authoring: AuthoringRepository | null
}

export function createServices(source: DataSource = DATA_SOURCE, baseUrl: string = API_BASE_URL): Services {
  if (source === 'remote') {
    return {
      repository: new RemoteRepository(baseUrl),
      agentClient: new RemoteAgentClient(baseUrl),
      authoring: new RemoteAuthoringRepository(baseUrl),
    }
  }
  return { repository: new MockRepository(), agentClient: new MockAgentClient(), authoring: null }
}

export const services = createServices()
