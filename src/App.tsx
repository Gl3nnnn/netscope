import { lazy } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'

const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const TopologyPage = lazy(() =>
  import('@/pages/TopologyPage').then((m) => ({ default: m.TopologyPage })),
)
const DevicesPage = lazy(() =>
  import('@/pages/DevicesPage').then((m) => ({ default: m.DevicesPage })),
)
const DeviceDetailPage = lazy(() =>
  import('@/pages/DeviceDetailPage').then((m) => ({
    default: m.DeviceDetailPage,
  })),
)
const PerformancePage = lazy(() =>
  import('@/pages/PerformancePage').then((m) => ({
    default: m.PerformancePage,
  })),
)
const IncidentsPage = lazy(() =>
  import('@/pages/IncidentsPage').then((m) => ({ default: m.IncidentsPage })),
)
const TimelinePage = lazy(() =>
  import('@/pages/TimelinePage').then((m) => ({ default: m.TimelinePage })),
)
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            index
            element={
              <ErrorBoundary>
                <DashboardPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="topology"
            element={
              <ErrorBoundary>
                <TopologyPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="devices"
            element={
              <ErrorBoundary>
                <DevicesPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="devices/:id"
            element={
              <ErrorBoundary>
                <DeviceDetailPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="performance"
            element={
              <ErrorBoundary>
                <PerformancePage />
              </ErrorBoundary>
            }
          />
          <Route
            path="incidents"
            element={
              <ErrorBoundary>
                <IncidentsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="timeline"
            element={
              <ErrorBoundary>
                <TimelinePage />
              </ErrorBoundary>
            }
          />
          <Route
            path="settings"
            element={
              <ErrorBoundary>
                <SettingsPage />
              </ErrorBoundary>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster
        position="top-right"
        theme="system"
        richColors
        closeButton
        toastOptions={{ className: 'text-sm' }}
      />
    </HashRouter>
  )
}
