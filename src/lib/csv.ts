/**
 * Parse CSV text into rows of cells. Handles quoted fields, escaped quotes, CRLF and a UTF-8 BOM.
 * Blank lines are dropped unless `keepBlank` is set (so callers can report real line numbers).
 */
export function parseCsv(text: string, { keepBlank = false } = {}): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return keepBlank ? rows : rows.filter((r) => !isBlankRow(r))
}

function isBlankRow(row: string[]) {
  return row.every((cell) => cell.trim() === '')
}

function escapeCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n')
}

export function downloadFile(filename: string, content: string, mimeType: string) {
  // BOM so Excel opens UTF-8 CSVs correctly.
  const prefix = mimeType.startsWith('text/csv') ? '﻿' : ''
  const blob = new Blob([prefix + content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
