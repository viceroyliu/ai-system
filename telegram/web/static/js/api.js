const API_BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  return res.json()
}

export const api = {
  getStatus: () => request('/status'),
  getMyUserId: () => request('/my_user_id'),
  
  getSettings: () => request('/settings'),
  saveSettings: (data) => request('/settings', { method: 'POST', body: data }),
  
  getChannels: (activeOnly = false) => request(`/channels?active_only=${activeOnly ? 1 : 0}`),
  toggleChannel: (id, active) => request(`/channels/${id}/toggle`, { method: 'POST', body: { active } }),
  pinChannel: (id, pinned) => request(`/channels/${id}/pin`, { method: 'POST', body: { pinned } }),
  deleteChannelMsgs: (id) => request(`/channels/${id}/messages`, { method: 'DELETE' }),
  getChannelCounts: () => request('/channel_counts'),
  getLastMessages: () => request('/last_messages'),
  
  getMessages: (channelId, query = '', limit = 100) => 
    request(`/messages?channel_id=${channelId}&q=${encodeURIComponent(query)}&limit=${limit}`),
  deleteMessage: (id) => request(`/messages/${id}`, { method: 'DELETE' }),
  sendMessage: (channelId, content) => 
    request('/send_message', { method: 'POST', body: { channel_id: channelId, content } }),
  
  getRequirements: () => request('/requirements'),
  createRequirement: (content) => request('/requirements', { method: 'POST', body: { content } }),
  updateRequirement: (id, data) => request(`/requirements/${id}`, { method: 'PUT', body: data }),
  deleteRequirement: (id) => request(`/requirements/${id}`, { method: 'DELETE' }),
  
  aiAssist: (messages, prompt, model) => 
    request('/ai_assist', { method: 'POST', body: { messages, prompt, model } })
}
