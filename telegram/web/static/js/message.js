import { state, resetSelection } from './state.js'
import { api } from './api.js'
import { fdate, ftime2, esc } from './ui.js'

export async function loadMessages(channelId) {
  const data = await api.getMessages(channelId)
  state.messages = data.messages.reverse()
  
  if (state.messages.length > 0) {
    state.lastMsgId = state.messages[state.messages.length - 1].id
  }
  
  renderMessages(true)
}

export async function smartReload() {
  if (!state.chat) return
  
  const data = await api.getMessages(state.chat)
  const newMsgs = data.messages.reverse()
  
  if (newMsgs.length > state.messages.length) {
    const lastNew = newMsgs[newMsgs.length - 1]
    const isMyMsg = lastNew.is_outgoing || (state.myUserId && lastNew.sender_id === state.myUserId)
    
    if (!isMyMsg || lastNew.id !== state.lastMsgId) {
      state.messages = newMsgs
      renderMessages(false)
    }
  }
}

function renderMedia(m) {
  if (!m.has_image) return ''
  
  if (m.media_type === 'gif') {
    return `<video class="msg-img" src="/api/image/${m.id}" autoplay loop muted playsinline></video>`
  } else if (m.media_type === 'photo') {
    return `<img class="msg-img" src="/api/image/${m.id}" loading="lazy">`
  }
  return ''
}

export function renderMessages(scrollToBottom = true) {
  const el = document.getElementById('msgs')
  if (!el) return
  
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
  
  if (!state.messages.length) {
    el.innerHTML = '<div class="empty"><p>暂无消息</p></div>'
    return
  }
  
  let html = ''
  let lastDate = ''
  
  state.messages.forEach((m, idx) => {
    const date = m.created_at.split('T')[0]
    if (date !== lastDate) {
      html += `<div class="date-divider"><span>${fdate(date)}</span></div>`
      lastDate = date
    }
    
    const isMe = m.is_outgoing || (state.myUserId && m.sender_id === state.myUserId)
    
    html += `
      <div class="msg ${isMe ? 'out' : 'in'}">
        ${!isMe ? `<div class="msg-avatar">${(m.sender_name || '?')[0]}</div>` : ''}
        <div class="msg-bubble">
          ${!isMe ? `<div class="msg-sender">${m.sender_name}</div>` : ''}
          ${m.content ? `<div class="msg-text">${esc(m.content)}</div>` : ''}
          ${renderMedia(m)}
          <div class="msg-time">${ftime2(m.created_at)}</div>
        </div>
      </div>
    `
  })
  
  el.innerHTML = html
  
  if (scrollToBottom || wasAtBottom) {
    el.scrollTop = el.scrollHeight
  }
}

export async function sendMessage(content) {
  if (!content.trim() || !state.chat) return
  
  await api.sendMessage(state.chat, content)
  
  setTimeout(() => loadMessages(state.chat), 2000)
}

window.sendMessage = sendMessage
