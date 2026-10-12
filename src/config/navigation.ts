import {
  Activity,
  BellRing,
  Clock,
  Gauge,
  LayoutDashboard,
  Route,
  SearchCode,
  Send,
  Server,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  description: string
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Fleet health at a glance',
  },
  {
    to: '/topology',
    label: 'Topology',
    icon: Share2,
    description: 'Interactive network map',
  },
  {
    to: '/tracer',
    label: 'Path Tracer',
    icon: Route,
    description: 'Trace routes between devices',
  },
  {
    to: '/devices',
    label: 'Devices',
    icon: Server,
    description: 'Inventory management',
  },
  {
    to: '/performance',
    label: 'Performance',
    icon: Activity,
    description: 'Historical metrics',
  },
  {
    to: '/sla',
    label: 'SLA & Uptime',
    icon: ShieldCheck,
    description: 'Service-level reporting',
  },
  {
    to: '/incidents',
    label: 'Incidents',
    icon: ShieldAlert,
    description: 'Open and past incidents',
  },
  {
    to: '/alerts',
    label: 'Alerts',
    icon: BellRing,
    description: 'Custom rule alerts',
  },
  {
    to: '/explorer',
    label: 'Explorer',
    icon: SearchCode,
    description: 'Query and overlay metrics',
  },
  {
    to: '/monitors',
    label: 'Monitors',
    icon: Gauge,
    description: 'Synthetic monitors',
  },
  {
    to: '/notifications',
    label: 'Notifications',
    icon: Send,
    description: 'Channels and escalation',
  },
  {
    to: '/timeline',
    label: 'Timeline',
    icon: Clock,
    description: 'Event history',
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings,
    description: 'Simulation and preferences',
  },
]
