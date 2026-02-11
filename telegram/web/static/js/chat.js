import { state } from './state.js'
import { api } from './api.js'
import { loadMessages } from './message.js'
import { ftime, esc } from './ui.js'

export async function loadChats() {
  const [chansData, counts, lastMsgs] = await Promise.all([
    api.getChannels(true),
    api.getChannelCounts(),
    api.getLastMessages()
  ])
  
  const allChats = chansData.channels.map(c => {
    const total = counts[c.id] || 0
    const read = state.settings.read[c.id] || 0
    const unread = c.id === state.chat ? 0 : Math.max(0, total - read)
    return { ...c, total, unread, last: lastMsgs[c.id] }
  })
  
  state.chats = allChats.filter(c => !c.is_requirement_channel)
  state.chats.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return a.name.localeCompare(b.name)
  })
  
  renderChats()
}

export function renderChats() {
  const el = document.getElementById('chats')
  if (!el) return
  
  if (!state.chats.length) {
    el.innerHTML = '<div class="empty"><p>点击设置添加频道</p></div>'
    return
  }
  
  el.innerHTML = state.chats.map(c => {
    const initial = c.name[0].toUpperCase()
    const preview = esc(c.last?.content || '').slice(0, 30)
    const time = c.last ? ftime(c.last.created_at) : ''
    
    let avatarClass = c.type === 'channel' ? 'channel' : c.type === 'group' ? 'group' : 'private'
    
    return `
      <div class="chat-item ${state.chat === c.id ? 'active' : ''} ${c.pinned ? 'pinned' : ''}" 
           onclick="selectChat(${c.id})">
        <div class="chat-avatar ${avatarClass}">${initial}</div>
        <div class="chat-content">
          <div class="chat-top">
            <span class="chat-name">${c.name}</span>
            <span class="chat-time">${time}</span>
          </div>
          <div class="chat-preview">${preview}</div>
        </div>
        ${c.unread > 0 ? `<span class="chat-badge">${c.unread}</span>` : ''}
      </div>
    `
  }).join('')
}

export function selectChat(id) {
  if (state.chat === id) return
  
  state.chat = id
  state.selectedMsgs.clear()
  state.lastMsgId = null
  
  const c = state.chats.find(x => x.id === id)
  if (c) {
    state.settings.read[id] = c.total
    c.unread = 0
    api.saveSettings(state.settings)
  }
  
  renderChats()
  loadMessages(id)
  updateHeader()
}

function updateHeader() {
  const c = state.chats.find(x => x.id === state.chat)
  if (!c) return
  
  document.getElementById('header').innerHTML = `
    <div class="header-avatar">${c.name[0].toUpperCase()}</div>
    <div class="header-info">
      <div class="header-name">${c.name}</div>
      <div class="header-desc">${c.type === 'channel' ? '频道' : '私聊'}</div>
    </div>
  `
}

window.selectChat = selectChat
