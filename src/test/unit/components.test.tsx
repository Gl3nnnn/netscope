import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '@/components/common/EmptyState'
import { SeverityBadge, StatusBadge } from '@/components/common/Badges'

describe('EmptyState', () => {
  it('renders a title and description', () => {
    render(<EmptyState title="Nothing here" description="Add something" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('Add something')).toBeInTheDocument()
  })

  it('has an accessible status role', () => {
    render(<EmptyState title="Empty" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

describe('badges', () => {
  it('renders the device status label', () => {
    render(<StatusBadge status="degraded" />)
    expect(screen.getByText('Degraded')).toBeInTheDocument()
  })

  it('renders the severity label', () => {
    render(<SeverityBadge severity="critical" />)
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })
})
