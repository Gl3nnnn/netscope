import {
  Activity,
  Clock,
  LayoutDashboard,
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
