import {
  Activity,
  BarChart3,
  BellRing,
  Briefcase,
  CalendarClock,
  ClipboardList,
  Clock,
  FileCog,
  FileCheck2,
  FlaskConical,
  Gauge,
  GitPullRequest,
  Globe2,
  HeartPulse,
  History,
  LayoutDashboard,
  LayoutGrid,
  Leaf,
  Lock,
  Network,
  Package,
  Route,
  Router,
  Scale,
  ScrollText,
  SearchCode,
  Send,
  Server,
  ServerCog,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  Telescope,
  Waypoints,
  Wifi,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  description: string
}

export interface NavSection {
  id: string
  label: string
  icon: LucideIcon
  items: NavItem[]
  /** Whether the section starts expanded (overridden by persisted state). */
  defaultOpen?: boolean
}

/** Pinned to the bottom of the sidebar, outside the collapsible sections. */
export const SETTINGS_ITEM: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: Settings,
  description: 'Simulation and preferences',
}

/**
 * Grouped navigation. Sections render as collapsible groups in the sidebar.
 * The "Deep Dive" section is intentionally empty at first and is populated by
 * the flow, IPAM, environment and lifecycle features.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutGrid,
    defaultOpen: true,
    items: [
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
        to: '/geo',
        label: 'Geo Map',
        icon: Globe2,
        description: 'Sites on a world map',
      },
    ],
  },
  {
    id: 'deep-dive',
    label: 'Deep Dive',
    icon: Telescope,
    defaultOpen: true,
    items: [
      {
        to: '/flows',
        label: 'Flows',
        icon: Network,
        description: 'Flow & application analytics',
      },
      {
        to: '/ipam',
        label: 'IPAM',
        icon: Router,
        description: 'IP & VLAN management',
      },
      {
        to: '/environment',
        label: 'Environment',
        icon: Leaf,
        description: 'Power, heat & carbon',
      },
      {
        to: '/lifecycle',
        label: 'Lifecycle',
        icon: Package,
        description: 'EOL & refresh planning',
      },
      {
        to: '/routing',
        label: 'Routing',
        icon: Waypoints,
        description: 'BGP, OSPF & route tables',
      },
      {
        to: '/qos',
        label: 'QoS',
        icon: Gauge,
        description: 'Classes, DSCP & queue health',
      },
      {
        to: '/wireless',
        label: 'Wireless',
        icon: Wifi,
        description: 'SSIDs, channels & coverage',
      },
    ],
  },
  {
    id: 'plan-test',
    label: 'Plan & Test',
    icon: Waypoints,
    items: [
      {
        to: '/tracer',
        label: 'Path Tracer',
        icon: Route,
        description: 'Trace routes between devices',
      },
      {
        to: '/planner',
        label: 'Planner',
        icon: FlaskConical,
        description: 'What-if capacity planning',
      },
      {
        to: '/resilience',
        label: 'Resilience',
        icon: HeartPulse,
        description: 'SPOF analysis and chaos lab',
      },
      {
        to: '/replay',
        label: 'Time Machine',
        icon: History,
        description: 'Replay and diff history',
      },
      {
        to: '/assistant',
        label: 'Ask NetScope',
        icon: Sparkles,
        description: 'Natural-language fleet Q&A',
      },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    icon: Scale,
    items: [
      {
        to: '/policy',
        label: 'Policy',
        icon: Lock,
        description: 'ACL and reachability analysis',
      },
      {
        to: '/configs',
        label: 'Config Drift',
        icon: FileCog,
        description: 'Baseline and running diff',
      },
      {
        to: '/compliance',
        label: 'Compliance',
        icon: FileCheck2,
        description: 'Hardening audit and waivers',
      },
      {
        to: '/changes',
        label: 'Changes',
        icon: GitPullRequest,
        description: 'CAB change management',
      },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    icon: ShieldAlert,
    defaultOpen: true,
    items: [
      {
        to: '/security',
        label: 'Security Ops',
        icon: ShieldAlert,
        description: 'SOC detections & ATT&CK',
      },
    ],
  },
  {
    id: 'transport',
    label: 'Transport',
    icon: Network,
    items: [
      {
        to: '/wan',
        label: 'WAN & Carriers',
        icon: Network,
        description: 'Circuits, SLAs & redundancy',
      },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: ServerCog,
    items: [
      {
        to: '/devices',
        label: 'Devices',
        icon: Server,
        description: 'Inventory management',
      },
      {
        to: '/services',
        label: 'Services',
        icon: Briefcase,
        description: 'Business services and impact',
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
        to: '/monitors',
        label: 'Monitors',
        icon: Gauge,
        description: 'Synthetic monitors',
      },
    ],
  },
  {
    id: 'response',
    label: 'Response',
    icon: Siren,
    items: [
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
        to: '/oncall',
        label: 'On-Call',
        icon: CalendarClock,
        description: 'Rotations and escalation',
      },
      {
        to: '/automation',
        label: 'Automation',
        icon: Workflow,
        description: 'Playbooks and maintenance',
      },
      {
        to: '/notifications',
        label: 'Notifications',
        icon: Send,
        description: 'Channels and escalation',
      },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: BarChart3,
    items: [
      {
        to: '/explorer',
        label: 'Explorer',
        icon: SearchCode,
        description: 'Query and overlay metrics',
      },
      {
        to: '/logs',
        label: 'Logs',
        icon: ScrollText,
        description: 'Syslog stream and patterns',
      },
      {
        to: '/reports',
        label: 'Reports',
        icon: ClipboardList,
        description: 'Executive report studio',
      },
      {
        to: '/timeline',
        label: 'Timeline',
        icon: Clock,
        description: 'Event history',
      },
    ],
  },
]

/**
 * Flat list of every navigable item (all sections + the pinned Settings item).
 * Consumed by the command palette so search always reaches collapsed sections.
 */
export const NAV_ITEMS: NavItem[] = [
  ...NAV_SECTIONS.flatMap((section) => section.items),
  SETTINGS_ITEM,
]
