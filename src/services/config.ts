// Where the app gets its data. Mock is the default. Set VITE_DATA_SOURCE=remote
// to talk to the Experience Agent backend (server/) at VITE_API_BASE_URL.
export type DataSource = 'mock' | 'remote'

export const DATA_SOURCE: DataSource = import.meta.env.VITE_DATA_SOURCE === 'remote' ? 'remote' : 'mock'

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787'
