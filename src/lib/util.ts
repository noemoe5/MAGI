export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export function base64ToText(b64: string): string {
  return decodeURIComponent(escape(atob(b64)))
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

// 渐变占位封面（无封面时按标题生成，避免空白卡片）
export function placeholderCover(title: string): string {
  const colors = ['#0179ca', '#008F91', '#6867D1', '#F97316', '#EC4999', '#8B5CF6', '#0EA5E9', '#14b8a6']
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0
  const a = colors[h % colors.length]
  const b = colors[(h >> 3) % colors.length]
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='220'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>
    </linearGradient></defs>
    <rect width='160' height='220' fill='url(#g)'/>
    <text x='80' y='115' font-size='15' fill='rgba(255,255,255,.92)' font-family='sans-serif'
      text-anchor='middle' dominant-baseline='middle'>${escapeXml(title.slice(0, 12))}</text>
  </svg>`
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string)
  )
}
