import { state } from './state.js'
import { api } from './api.js'
import { fdatetime, esc, show } from './ui.js'

export async function loadReqs() {
  const data = await api.getRequirements()
  
  console.log('原始需求数据:', data.requirements)
  
  const grouped = {}
  
  data.requirements.forEach(r => {
    if (r.source?.startsWith('reply:')) {
      const parts = r.source.split(':')
      const parentKey = `${parts[1]}:${parts[2]}`
      if (!grouped[parentKey]) grouped[parentKey] = { main: null, replies: [] }
      grouped[parentKey].replies.push(r)
    } else if (r.source?.startsWith('channel:')) {
      const parts = r.source.split(':')
      const key = `${parts[1]}:${parts[2]}`
      if (!grouped[key]) grouped[key] = { main: r, replies: [] }
      else grouped[key].main = r
    } else {
      grouped[`manual:${r.id}`] = { main: r, replies: [] }
    }
  })
  
  state.reqs = Object.values(grouped).filter(g => g.main)
  
  console.log('分组后:', state.reqs.map(g => ({ 
    main: g.main.content.slice(0, 20), 
    replies: g.replies.length 
  })))
  
  state.reqs.sort((a, b) => {
    if (a.main.pinned && !b.main.pinned) return -1
    if (!a.main.pinned && b.main.pinned) return 1
    if (a.main.status !== 'done' && b.main.status === 'done') return -1
    if (a.main.status === 'done' && b.main.status !== 'done') return 1
    return new Date(b.main.created_at) - new Date(a.main.created_at)
  })
  
  renderReqs()
}

export function renderReqs() {
  const el = document.getElementById('reqs')
  if (!el) return
  
  if (!state.reqs.length) {
    el.innerHTML = '<div class="empty"><p>暂无需求</p></div>'
    return
  }
  
  el.innerHTML = state.reqs.map((group, idx) => {
    const r = group.main
    const isDone = r.status === 'done'
    const hasReplies = group.replies.length > 0
    const isCollapsed = state.collapsedGroups.has(idx)
    
    return `
      <div class="req-group ${isDone ? 'done' : ''} ${r.pinned ? 'pinned' : ''} ${isCollapsed ? 'collapsed' : ''}">
        <div class="req-main" 
             onclick="showReqDrawer(${r.id})"
             oncontextmenu="showReqContextMenu(event, ${r.id}, '${r.status}', ${r.pinned ? 1 : 0})">
          <div class="req-header-row">
            <span class="req-time">${fdatetime(r.created_at)}</span>
            <div class="req-actions">
              ${hasReplies ? `<button class="req-expand" onclick="event.stopPropagation(); toggleReqGroup(${idx})">${isCollapsed ? '▶' : '▼'}</button>` : ''}
              ${isDone ? '<span class="req-done-badge">✓</span>' : `<button class="req-check" onclick="event.stopPropagation(); quickDone(${r.id})">✓</button>`}
            </div>
          </div>
          <div class="req-content">${esc(r.content)}</div>
        </div>
        
        ${hasReplies && !isCollapsed ? `
          <div class="req-replies">
            ${group.replies.map(reply => `
              <div class="req-reply">
                <span class="reply-time">${fdatetime(reply.created_at)}</span>
                <span class="reply-text">${esc(reply.content)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `
  }).join('')
}

export function toggleReqGroup(idx) {
  if (state.collapsedGroups.has(idx)) state.collapsedGroups.delete(idx)
  else state.collapsedGroups.add(idx)
  renderReqs()
}

export async function quickDone(id) {
  await api.updateRequirement(id, { status: 'done' })
  setTimeout(loadReqs, 500)
}

export function showReqDrawer(id) {
  const group = state.reqs.find(g => g.main.id === id)
  if (!group) return
  
  const r = group.main
  
  let html = `
    <div style="margin-bottom:20px;">
      <div style="font-size:13px;color:var(--text-2);margin-bottom:8px;">
        ${fdatetime(r.created_at)}
        <span style="margin-left:12px;padding:4px 12px;background:${r.status === 'done' ? 'var(--success)' : '#f59e0b'};color:#fff;border-radius:12px;font-size:12px;">
          ${r.status === 'done' ? '已处理' : '待处理'}
        </span>
      </div>
      <div style="font-size:16px;line-height:1.6;white-space:pre-wrap;">${esc(r.content)}</div>
    </div>
  `
  
  if (group.replies.length > 0) {
    html += `
      <div style="border-top:1px solid var(--border);padding-top:20px;">
        <h4 style="font-size:14px;color:var(--text-2);margin-bottom:16px;">回复记录 (${group.replies.length})</h4>
        ${group.replies.map(reply => `
          <div style="background:var(--bg-3);padding:12px;border-radius:8px;margin-bottom:12px;border-left:3px solid var(--accent);">
            <div style="font-size:12px;color:var(--text-2);margin-bottom:6px;">${fdatetime(reply.created_at)}</div>
            <div style="font-size:14px;line-height:1.5;">${esc(reply.content)}</div>
          </div>
        `).join('')}
      </div>
    `
  }
  
  html += `
    <div style="margin-top:24px;display:flex;gap:12px;">
      <button class="btn btn-secondary" onclick="toggleReqStatus(${r.id}, '${r.status}')" style="flex:1;">
        ${r.status === 'done' ? '标记待处理' : '标记已处理'}
      </button>
      <button class="btn" style="background:var(--danger);color:#fff;flex:1;" onclick="deleteReq(${r.id})">删除</button>
    </div>
  `
  
  document.getElementById('req-detail').innerHTML = html
  show('req-drawer')
}

window.showReqContextMenu = function(e, id, status, pinned) {
  showContextMenu(e, [
    { label: pinned ? '📌 取消置顶' : '📌 置顶', action: `toggleReqPin(${id})` },
    { label: status === 'done' ? '⏱ 待处理' : '✓ 已处理', action: `toggleReqStatus(${id}, '${status}')` },
    { divider: true },
    { label: '🗑 删除', action: `deleteReq(${id})`, danger: true }
  ])
}

window.toggleReqPin = async function(id) {
  const group = state.reqs.find(g => g.main.id === id)
  if (!group) return
  await api.updateRequirement(id, { pinned: !group.main.pinned })
  setTimeout(loadReqs, 500)
}

window.closeReqDrawer = function() {
  document.getElementById('req-drawer').classList.remove('show')
}

window.toggleReqStatus = async function(id, current) {
  await api.updateRequirement(id, { status: current === 'done' ? 'pending' : 'done' })
  closeReqDrawer()
  setTimeout(loadReqs, 500)
}

window.deleteReq = async function(id) {
  if (!confirm('确定删除？')) return
  await api.deleteRequirement(id)
  closeReqDrawer()
  setTimeout(loadReqs, 500)
}

window.toggleReqGroup = toggleReqGroup
window.quickDone = quickDone
window.showReqDrawer = showReqDrawer
