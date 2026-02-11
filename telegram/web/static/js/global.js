import { state } from './state.js'
import { api } from './api.js'
import { loadReqs } from './requirement.js'
import { sendMessage as sendMsg } from './message.js'
import { show, hide } from './ui.js'

// 发送消息
window.handleSend = async function() {
  const input = document.getElementById('input')
  const text = input.value.trim()
  if (!text) return
  
  await sendMsg(text)
  input.value = ''
}

// 新建需求
window.showAddReqModal = function() {
  document.getElementById('req-input').value = ''
  show('add-req-modal')
}

window.createReq = async function() {
  const text = document.getElementById('req-input').value.trim()
  if (!text) return
  
  await api.createRequirement(text)
  hide('add-req-modal')
  setTimeout(loadReqs, 500)
}

// AI 辅助
window.showAiModal = function() {
  const selected = state.messages.slice(-5)
  const context = selected.map(m => `${m.sender_name}: ${m.content || ''}`).join('\n')
  
  document.getElementById('ai-context').value = context
  document.getElementById('ai-result').value = ''
  show('ai-modal')
}

window.generateAi = async function() {
  const btn = event.target
  btn.disabled = true
  btn.textContent = '⏳ 生成中...'
  
  try {
    const context = document.getElementById('ai-context').value.split('\n')
    const result = await api.aiAssist(context, state.settings.aiPrompt, state.settings.aiModel)
    document.getElementById('ai-result').value = result.reply || '生成失败'
  } catch (e) {
    document.getElementById('ai-result').value = '生成失败: ' + e.message
  }
  
  btn.disabled = false
  btn.textContent = '✨ 生成回复建议'
}

window.useAiResult = function() {
  document.getElementById('input').value = document.getElementById('ai-result').value
  hide('ai-modal')
}

// 设置
window.showSettings = async function() {
  const models = await fetch('http://localhost:11434/api/tags').then(r => r.json()).catch(() => ({ models: [] }))
  
  const modelSelect = document.getElementById('ai-model')
  modelSelect.innerHTML = models.models.map(m => 
    `<option value="${m.name}" ${m.name === state.settings.aiModel ? 'selected' : ''}>${m.name}</option>`
  ).join('') || '<option>无可用模型</option>'
  
  document.getElementById('ai-prompt').value = state.settings.aiPrompt
  show('settings-modal')
}

window.saveAiModel = function() {
  state.settings.aiModel = document.getElementById('ai-model').value
  api.saveSettings(state.settings)
}

window.saveAiPrompt = function() {
  state.settings.aiPrompt = document.getElementById('ai-prompt').value
  api.saveSettings(state.settings)
  alert('已保存')
}

// 主题
window.toggleTheme = function() {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'
  document.body.dataset.theme = state.settings.theme
  api.saveSettings(state.settings)
}

// 搜索
window.onSearch = function(query) {
  // 搜索逻辑
  console.log('搜索:', query)
}

// 清除未读
window.clearUnread = function() {
  state.chats.forEach(c => {
    state.settings.read[c.id] = c.total
    c.unread = 0
  })
  api.saveSettings(state.settings)
  import('./chat.js').then(m => m.renderChats())
}

// 模态框
window.hideModal = hide

// 右键菜单
const ctx = document.createElement('div')
ctx.id = 'ctx-menu'
ctx.className = 'context-menu'
document.body.appendChild(ctx)

document.addEventListener('click', () => {
  ctx.classList.remove('show')
})

window.showContextMenu = function(e, items) {
  e.preventDefault()
  e.stopPropagation()
  
  ctx.innerHTML = items.map(item => {
    if (item.divider) return '<div class="ctx-divider"></div>'
    return `<div class="ctx-item ${item.danger ? 'danger' : ''}" onclick="${item.action}">${item.label}</div>`
  }).join('')
  
  ctx.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`
  ctx.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`
  ctx.classList.add('show')
}
