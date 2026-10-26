import { ArrowRightLeft, Pencil } from 'lucide-react'

/** Edit and Change status buttons shown at the start of each table row. */
export default function RowActions({ name, onEdit, onStatus }: { name: string; onEdit: () => void; onStatus: () => void }) {
  return (
    <span className="row-actions-front">
      <button type="button" className="row-action edit" onClick={onEdit} aria-label={`Edit ${name}`} title="Edit (and view history)">
        <Pencil size={15} />
      </button>
      <button type="button" className="row-action status" onClick={onStatus} aria-label={`Change status of ${name}`} title="Change status, replace, dispose or cancel">
        <ArrowRightLeft size={15} />
      </button>
    </span>
  )
}
