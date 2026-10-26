import { Link } from 'react-router-dom'
import { Archive, Download, Upload, ChevronRight } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const tools = [
  { to: '/reports/export', icon: Download, title: 'Export', text: 'Download the asset register or a replacement schedule as an Excel file or PDF report.' },
  { to: '/reports/import', icon: Upload, title: 'Import', text: 'Upload a CSV file to add or update assets in bulk.' },
  { to: '/reports/disposals', icon: Archive, title: 'Disposals & Deletions', text: 'Every disposed asset with its reason and proceeds, and every cancelled or deleted record.' },
]

export default function Reports() {
  return (
    <>
      <PageHeader title="Reports" description="Depreciation schedules, additions, disposals and more." />
      <div className="tool-grid">
        {tools.map(({ to, icon: Icon, title, text }) => (
          <Link key={to} to={to} className="card tool-card">
            <span className="tool-icon"><Icon size={20} strokeWidth={1.75} /></span>
            <span className="tool-body">
              <span className="tool-title">{title}</span>
              <span className="tool-text">{text}</span>
            </span>
            <ChevronRight size={18} className="tool-chevron" />
          </Link>
        ))}
      </div>
    </>
  )
}
