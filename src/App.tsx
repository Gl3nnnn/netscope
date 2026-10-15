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
const GeoPage = lazy(() =>
  import('@/pages/GeoPage').then((m) => ({ default: m.GeoPage })),
)
const FlowsPage = lazy(() =>
  import('@/pages/FlowsPage').then((m) => ({ default: m.FlowsPage })),
)
const IpamPage = lazy(() =>
  import('@/pages/IpamPage').then((m) => ({ default: m.IpamPage })),
)
const EnvironmentPage = lazy(() =>
  import('@/pages/EnvironmentPage').then((m) => ({
    default: m.EnvironmentPage,
  })),
)
const LifecyclePage = lazy(() =>
  import('@/pages/LifecyclePage').then((m) => ({ default: m.LifecyclePage })),
)
const SecurityPage = lazy(() =>
  import('@/pages/SecurityPage').then((m) => ({ default: m.SecurityPage })),
)
const VulnerabilitiesPage = lazy(() =>
  import('@/pages/VulnerabilitiesPage').then((m) => ({
    default: m.VulnerabilitiesPage,
  })),
)
const NacPage = lazy(() =>
  import('@/pages/NacPage').then((m) => ({ default: m.NacPage })),
)
const AttackPathsPage = lazy(() =>
  import('@/pages/AttackPathsPage').then((m) => ({
    default: m.AttackPathsPage,
  })),
)
const RoutingPage = lazy(() =>
  import('@/pages/RoutingPage').then((m) => ({ default: m.RoutingPage })),
)
const QosPage = lazy(() =>
  import('@/pages/QosPage').then((m) => ({ default: m.QosPage })),
)
const WirelessPage = lazy(() =>
  import('@/pages/WirelessPage').then((m) => ({ default: m.WirelessPage })),
)
const WanPage = lazy(() =>
  import('@/pages/WanPage').then((m) => ({ default: m.WanPage })),
)
const VoicePage = lazy(() =>
  import('@/pages/VoicePage').then((m) => ({ default: m.VoicePage })),
)
const TracerPage = lazy(() =>
  import('@/pages/TracerPage').then((m) => ({ default: m.TracerPage })),
)
const PlannerPage = lazy(() =>
  import('@/pages/PlannerPage').then((m) => ({ default: m.PlannerPage })),
)
const ResiliencePage = lazy(() =>
  import('@/pages/ResiliencePage').then((m) => ({
    default: m.ResiliencePage,
  })),
)
const PolicyPage = lazy(() =>
  import('@/pages/PolicyPage').then((m) => ({ default: m.PolicyPage })),
)
const ConfigsPage = lazy(() =>
  import('@/pages/ConfigsPage').then((m) => ({ default: m.ConfigsPage })),
)
const CompliancePage = lazy(() =>
  import('@/pages/CompliancePage').then((m) => ({
    default: m.CompliancePage,
  })),
)
const CertificatesPage = lazy(() =>
  import('@/pages/CertificatesPage').then((m) => ({
    default: m.CertificatesPage,
  })),
)
const ChangesPage = lazy(() =>
  import('@/pages/ChangesPage').then((m) => ({ default: m.ChangesPage })),
)
const ReportsPage = lazy(() =>
  import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
)
const DevicesPage = lazy(() =>
  import('@/pages/DevicesPage').then((m) => ({ default: m.DevicesPage })),
)
const ServicesPage = lazy(() =>
  import('@/pages/ServicesPage').then((m) => ({ default: m.ServicesPage })),
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
const IncidentRoomPage = lazy(() =>
  import('@/pages/IncidentRoomPage').then((m) => ({
    default: m.IncidentRoomPage,
  })),
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
const ProblemsPage = lazy(() =>
  import('@/pages/ProblemsPage').then((m) => ({ default: m.ProblemsPage })),
)
const ExplorerPage = lazy(() =>
  import('@/pages/ExplorerPage').then((m) => ({ default: m.ExplorerPage })),
)
const LogsPage = lazy(() =>
  import('@/pages/LogsPage').then((m) => ({ default: m.LogsPage })),
)
const MonitorsPage = lazy(() =>
  import('@/pages/MonitorsPage').then((m) => ({ default: m.MonitorsPage })),
)
const ExperiencePage = lazy(() =>
  import('@/pages/ExperiencePage').then((m) => ({
    default: m.ExperiencePage,
  })),
)
const StatusPage = lazy(() =>
  import('@/pages/StatusPage').then((m) => ({ default: m.StatusPage })),
)
const NotificationsPage = lazy(() =>
  import('@/pages/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
)
const AutomationPage = lazy(() =>
  import('@/pages/AutomationPage').then((m) => ({
    default: m.AutomationPage,
  })),
)
const OnCallPage = lazy(() =>
  import('@/pages/OnCallPage').then((m) => ({ default: m.OnCallPage })),
)
const ReplayPage = lazy(() =>
  import('@/pages/ReplayPage').then((m) => ({ default: m.ReplayPage })),
)
const AskPage = lazy(() =>
  import('@/pages/AskPage').then((m) => ({ default: m.AskPage })),
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
            path="geo"
            element={
              <ErrorBoundary>
                <GeoPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="flows"
            element={
              <ErrorBoundary>
                <FlowsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="ipam"
            element={
              <ErrorBoundary>
                <IpamPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="environment"
            element={
              <ErrorBoundary>
                <EnvironmentPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="lifecycle"
            element={
              <ErrorBoundary>
                <LifecyclePage />
              </ErrorBoundary>
            }
          />
          <Route
            path="security"
            element={
              <ErrorBoundary>
                <SecurityPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="vulnerabilities"
            element={
              <ErrorBoundary>
                <VulnerabilitiesPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="access"
            element={
              <ErrorBoundary>
                <NacPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="attack-paths"
            element={
              <ErrorBoundary>
                <AttackPathsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="routing"
            element={
              <ErrorBoundary>
                <RoutingPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="qos"
            element={
              <ErrorBoundary>
                <QosPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="wireless"
            element={
              <ErrorBoundary>
                <WirelessPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="wan"
            element={
              <ErrorBoundary>
                <WanPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="voice"
            element={
              <ErrorBoundary>
                <VoicePage />
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
            path="resilience"
            element={
              <ErrorBoundary>
                <ResiliencePage />
              </ErrorBoundary>
            }
          />
          <Route
            path="policy"
            element={
              <ErrorBoundary>
                <PolicyPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="configs"
            element={
              <ErrorBoundary>
                <ConfigsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="compliance"
            element={
              <ErrorBoundary>
                <CompliancePage />
              </ErrorBoundary>
            }
          />
          <Route
            path="certificates"
            element={
              <ErrorBoundary>
                <CertificatesPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="reports"
            element={
              <ErrorBoundary>
                <ReportsPage />
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
            path="services"
            element={
              <ErrorBoundary>
                <ServicesPage />
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
            path="incidents/:id"
            element={
              <ErrorBoundary>
                <IncidentRoomPage />
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
            path="problems"
            element={
              <ErrorBoundary>
                <ProblemsPage />
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
            path="logs"
            element={
              <ErrorBoundary>
                <LogsPage />
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
            path="experience"
            element={
              <ErrorBoundary>
                <ExperiencePage />
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
            path="automation"
            element={
              <ErrorBoundary>
                <AutomationPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="changes"
            element={
              <ErrorBoundary>
                <ChangesPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="oncall"
            element={
              <ErrorBoundary>
                <OnCallPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="replay"
            element={
              <ErrorBoundary>
                <ReplayPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="assistant"
            element={
              <ErrorBoundary>
                <AskPage />
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
