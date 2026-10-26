import PageHeader from '../components/PageHeader'
import type { NavItem } from '../navigation'

export default function PlaceholderPage({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <div className="card empty-state">
        <Icon size={28} strokeWidth={1.5} />
        <h2>Nothing here yet</h2>
        <p>This section is scaffolded and ready to build out.</p>
      </div>
    </>
  )
}
