import { state } from './state.js'
import { api } from './api.js'
import { loadChats } from './chat.js'
import { loadReqs } from './requirement.js'
import { smartReload } from './message.js'
import './global.js'

async function init() {
  try {
    const settings = await api.getSettings()
    state.settings = settings
    document.body.dataset.theme = settings.theme
    
    const userIdData = await api.getMyUserId()
    state.myUserId = userIdData.user_id
    
    await Promise.all([loadChats(), loadReqs()])
    
    checkStatus()
    
    setInterval(checkStatus, 5000)
    setInterval(loadChats, 5000)
    setInterval(loadReqs, 10000)
    setInterval(smartReload, 3000)
  } catch (e) {
    console.error('初始化失败:', e)
  }
}

async function checkStatus() {
  try {
    const data = await api.getStatus()
    state.online = data.connected
    updateStatus()
  } catch {
    state.online = false
    updateStatus()
  }
}

function updateStatus() {
  const el = document.getElementById('status')
  if (!el) return
  
  el.className = `status-badge ${state.online ? 'online' : 'offline'}`
  el.innerHTML = `<span class="status-dot ${state.online ? 'online' : 'offline'}"></span>${state.online ? '已连接' : '离线'}`
}

init()
