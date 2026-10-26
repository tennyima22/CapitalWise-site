const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const compactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })

export const formatMoney = (n: number | null | undefined) => (n == null ? '' : money.format(n))
export const formatNumber = (n: number | null | undefined) => (n == null ? '' : number.format(n))
/** 1,284 -> "1.3K"; values under 1,000 are shown in full. */
export const formatCompact = (n: number) => (Math.abs(n) < 1000 ? number.format(n) : compact.format(n))
/** 4,200,000 -> "$4.2M"; values under $1,000 are shown in full. */
export const formatCompactMoney = (n: number) => (Math.abs(n) < 1000 ? money.format(n) : compactMoney.format(n))
