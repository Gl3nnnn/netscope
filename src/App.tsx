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
const TracerPage = lazy(() =>
  import('@/pages/TracerPage').then((m) => ({ default: m.TracerPage })),
)
const PlannerPage = lazy(() =>
  import('@/pages/PlannerPage').then((m) => ({ default: m.PlannerPage })),
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
const SlaPage = lazy(() =>
  import('@/pages/SlaPage').then((m) => ({ default: m.SlaPage })),
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
const AlertsPage = lazy(() =>
  import('@/pages/AlertsPage').then((m) => ({ default: m.AlertsPage })),
)
const ExplorerPage = lazy(() =>
  import('@/pages/ExplorerPage').then((m) => ({ default: m.ExplorerPage })),
)
const MonitorsPage = lazy(() =>
  import('@/pages/MonitorsPage').then((m) => ({ default: m.MonitorsPage })),
)
const StatusPage = lazy(() =>
  import('@/pages/StatusPage').then((m) => ({ default: m.StatusPage })),
)
const NotificationsPage = lazy(() =>
  import('@/pages/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
)
const WallboardPage = lazy(() =>
  import('@/pages/WallboardPage').then((m) => ({ default: m.WallboardPage })),
)

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route
          path="wallboard"
          element={
            <ErrorBoundary>
              <WallboardPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="status"
          element={
            <ErrorBoundary>
              <StatusPage />
            </ErrorBoundary>
          }
        />
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
            path="tracer"
            element={
              <ErrorBoundary>
                <TracerPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="planner"
            element={
              <ErrorBoundary>
                <PlannerPage />
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
            path="sla"
            element={
              <ErrorBoundary>
                <SlaPage />
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
            path="alerts"
            element={
              <ErrorBoundary>
                <AlertsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="explorer"
            element={
              <ErrorBoundary>
                <ExplorerPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="monitors"
            element={
              <ErrorBoundary>
                <MonitorsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="notifications"
            element={
              <ErrorBoundary>
                <NotificationsPage />
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
