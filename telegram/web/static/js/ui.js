export function ftime(s) {
  const d = new Date(s)
  const n = new Date()
  const diff = n - d
  
  if (diff < 86400000 && d.getDate() === n.getDate()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  
  if (diff < 604800000) {
    return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  }
  
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function fdate(s) {
  const d = new Date(s)
  const n = new Date()
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate())
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = (today - msgDate) / 86400000
  
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function ftime2(s) {
  return new Date(s).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function fdatetime(s) {
  const d = new Date(s)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

export function esc(t) {
  const div = document.createElement('div')
  div.textContent = t || ''
  return div.innerHTML
}

export function show(id) {
  const el = document.getElementById(id)
  if (el) el.classList.add('show')
}

export function hide(id) {
  const el = document.getElementById(id)
  if (el) el.classList.remove('show')
}
