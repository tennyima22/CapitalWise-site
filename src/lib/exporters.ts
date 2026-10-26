/** Excel and PDF downloads. The libraries are loaded only when someone exports. */
import { formatMoney, formatNumber } from './format'

export type Cell = string | number | null

export interface ExportColumn {
  header: string
  kind?: 'text' | 'number' | 'money' | 'year'
  /** Shown in the PDF too. Wide reports keep every column in Excel and only the key ones in the PDF. */
  pdf?: boolean
}

export interface ExportTable {
  title: string
  /** Lines under the title, e.g. date generated and inflation rate. */
  subtitle: string[]
  columns: ExportColumn[]
  rows: Cell[][]
  /** Optional extra table printed after the main one (e.g. spending by year). */
  summary?: { title: string; columns: ExportColumn[]; rows: Cell[][] }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const MONEY_FORMAT = '#,##0.00'
const ACCENT = '7C5CFF'

export async function exportExcel(table: ExportTable, filename: string) {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  book.creator = 'CapitalWise'
  book.created = new Date()

  const addSheet = (name: string, columns: ExportColumn[], rows: Cell[][]) => {
    const sheet = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.columns = columns.map((c, i) => {
      // Width from the longest value in the column, within sensible limits.
      const longest = Math.max(c.header.length, ...rows.map((r) => (r[i] == null ? 0 : String(r[i]).length + (c.kind === 'money' ? 4 : 0))))
      return { header: c.header, width: Math.min(Math.max(longest + 2, 10), 48) }
    })
    // Money to the cent, so cells hold the same value they display.
    rows.forEach((r) => sheet.addRow(r.map((v, i) => (typeof v === 'number' && columns[i].kind === 'money' ? Math.round(v * 100) / 100 : v ?? ''))))
    columns.forEach((c, i) => {
      if (c.kind === 'money') sheet.getColumn(i + 1).numFmt = MONEY_FORMAT
      if (c.kind === 'money' || c.kind === 'number') sheet.getColumn(i + 1).alignment = { horizontal: 'right' }
    })
    const header = sheet.getRow(1)
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${ACCENT}` } }
    header.alignment = { vertical: 'middle', wrapText: true }
    header.height = 30
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  }

  addSheet(table.title.slice(0, 31), table.columns, table.rows)
  if (table.summary) addSheet(table.summary.title.slice(0, 31), table.summary.columns, table.summary.rows)

  const buffer = await book.xlsx.writeBuffer()
  saveBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename)
}

function formatCell(value: Cell, kind: ExportColumn['kind']) {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && kind === 'money') return formatMoney(value)
  if (typeof value === 'number' && kind === 'number') return formatNumber(value)
  return String(value)
}

export async function exportPdf(table: ExportTable, filename: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 32

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(20, 18, 41)
  doc.text(table.title, margin, 42)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 100, 120)
  table.subtitle.forEach((line, i) => doc.text(line, margin, 58 + i * 12))

  const printTable = (columns: ExportColumn[], rows: Cell[][], startY: number, compact = false) => {
    const keep = columns.map((c, i) => [c, i] as const).filter(([c]) => c.pdf !== false)
    autoTable(doc, {
      startY,
      tableWidth: compact ? 360 : 'auto',
      margin: { left: margin, right: margin, bottom: 36 },
      head: [keep.map(([c]) => c.header)],
      body: rows.map((r) => keep.map(([c, i]) => formatCell(r[i], c.kind))),
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 4, overflow: 'linebreak', textColor: [30, 30, 40], lineColor: [226, 224, 240], lineWidth: 0.5 },
      headStyles: { fillColor: [124, 92, 255], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 245, 252] },
      columnStyles: Object.fromEntries(keep.map(([c], j) => [j, c.kind === 'money' || c.kind === 'number' ? { halign: 'right' } : {}])),
    })
  }

  printTable(table.columns, table.rows, 58 + table.subtitle.length * 12 + 6)

  if (table.summary) {
    doc.addPage()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(20, 18, 41)
    doc.text(table.summary.title, margin, 42)
    printTable(table.summary.columns, table.summary.rows, 54, true)
  }

  // Footer with page numbers on every page.
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(140, 140, 160)
    doc.text('CapitalWise', margin, doc.internal.pageSize.getHeight() - 16)
    doc.text(`Page ${p} of ${pages}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 16, { align: 'right' })
  }

  doc.save(filename)
}
