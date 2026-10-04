import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppHeader } from './AppHeader'

describe('AppHeader', () => {
  it('shows the Experience Playground title and the VDS attribution', () => {
    render(<AppHeader route={{ mode: 'playground' }} />)

    expect(screen.getByText('Experience Playground')).toBeInTheDocument()
    expect(screen.getByText('VDS')).toBeInTheDocument()
  })
})
