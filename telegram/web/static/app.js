const state = {
    chat: null,
    chats: [],
    messages: [],
    reqs: [],
    settings: { theme: 'dark', order: [], read: {}, aiModel: 'qwen2.5:14b-instruct' },
    online: false
};

let timer = null;
let lastChatLoad = 0;

async function init() {
    await loadSettings();
    document.body.dataset.theme = state.settings.theme;
    
    await Promise.all([loadChats(), loadReqs()]);
    checkStatus();
    
    if (state.chats[0]) selectChat(state.chats[0].id);
    
    setInterval(checkStatus, 5000);
    setInterval(loadChats, 5000);
    setInterval(() => state.chat && loadMsgs(state.chat), 3000);
    setInterval(loadReqs, 15000);
    
    setupContextMenu();
    setupModalClose();
}

async function load(path, opt = {}) {
    const res = await fetch('/api/' + path, {
        headers: { 'Content-Type': 'application/json' },
        ...opt,
        body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    return res.json();
}

async function loadSettings() {
    try {
        state.settings = await load('settings');
        state.settings.read = state.settings.read || {};
        state.settings.aiModel = state.settings.aiModel || 'qwen2.5:14b-instruct';
    } catch (e) {
        console.error('加载设置失败:', e);
    }
}

async function saveSettings() {
    try {
        await load('settings', { method: 'POST', body: state.settings });
    } catch (e) {
        console.error('保存设置失败:', e);
    }
}

async function checkStatus() {
    try {
        const data = await load('status');
        state.online = data.connected;
        updateStatus();
    } catch {
        state.online = false;
        updateStatus();
    }
}

function updateStatus() {
    const el = document.getElementById('status');
    if (!el) return;
    el.className = `status-badge ${state.online ? 'online' : 'offline'}`;
    el.innerHTML = `<span class="status-dot ${state.online ? 'online' : 'offline'}"></span>${state.online ? '已连接' : '离线'}`;
}

async function loadChats() {
    const now = Date.now();
    if (now - lastChatLoad < 2000) return;
    lastChatLoad = now;
    
    const [chans, counts, last] = await Promise.all([
        load('channels?active_only=1'),
        load('channel_counts'),
        load('last_messages')
    ]);
    
    state.chats = chans.channels.map(c => {
        const total = counts[c.id] || 0;
        const read = state.settings.read[c.id] || 0;
        return {
            ...c,
            total,
            unread: Math.max(0, total - read),
            last: last[c.id]
        };
    });
    
    renderChats();
}

function renderChats() {
    const el = document.getElementById('chats');
    if (!el) return;
    
    if (!state.chats.length) {
        el.innerHTML = '<div class="empty"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg><p>点击设置添加频道</p></div>';
        return;
    }
    
    el.innerHTML = state.chats.map(c => `
        <div class="chat-item ${state.chat === c.id ? 'active' : ''}" 
             onclick="selectChat(${c.id})"
             oncontextmenu="showChatCtx(event, ${c.id})">
            <div class="chat-avatar">${c.name[0].toUpperCase()}</div>
            <div class="chat-content">
                <div class="chat-top">
                    <span class="chat-name">${c.name}</span>
                    <span class="chat-time">${c.last ? ftime(c.last.created_at) : ''}</span>
                </div>
                <div class="chat-preview">${esc(c.last?.content || '').slice(0, 30)}</div>
            </div>
            ${c.unread > 0 ? `<span class="chat-badge">${c.unread}</span>` : ''}
        </div>
    `).join('');
}

function selectChat(id) {
    if (state.chat === id) return;
    state.chat = id;
    const c = state.chats.find(x => x.id === id);
    if (c) {
        state.settings.read[id] = c.total;
        c.unread = 0;
        saveSettings();
    }
    renderChats();
    loadMsgs(id);
    updateHeader();
}

function clearUnread() {
    state.chats.forEach(c => {
        state.settings.read[c.id] = c.total;
        c.unread = 0;
    });
    saveSettings();
    renderChats();
}

function markRead(id) {
    const c = state.chats.find(x => x.id === id);
    if (c) {
        state.settings.read[id] = c.total;
        c.unread = 0;
        saveSettings();
        renderChats();
    }
}

function updateHeader() {
    const c = state.chats.find(x => x.id === state.chat);
    if (!c) return;
    document.getElementById('header').innerHTML = `
        <div class="header-avatar">${c.name[0].toUpperCase()}</div>
        <div class="header-info">
            <div class="header-name">${c.name}</div>
            <div class="header-desc">${c.type === 'private' ? '私聊' : '群组'}</div>
        </div>
    `;
}

async function loadMsgs(id) {
    const data = await load(`messages?channel_id=${id}&limit=80`);
    state.messages = data.messages.reverse();
    renderMsgs();
}

function renderMsgs() {
    const el = document.getElementById('msgs');
    if (!el) return;
    
    if (!state.messages.length) {
        el.innerHTML = '<div class="empty"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg><p>暂无消息</p></div>';
        return;
    }
    
    let html = '';
    let lastDate = '';
    let lastSender = '';
    
    state.messages.forEach(m => {
        const date = m.created_at.split('T')[0];
        if (date !== lastDate) {
            html += `<div class="date-divider"><span>${fdate(date)}</span></div>`;
            lastDate = date;
            lastSender = '';
        }
        
        const isMe = m.is_outgoing || m.sender_name === 'Me';
        const showAvatar = m.sender_name !== lastSender;
        lastSender = m.sender_name;
        
        html += `
            <div class="msg ${isMe ? 'out' : 'in'}" oncontextmenu="showMsgCtx(event, ${m.id})">
                ${showAvatar ? `<div class="msg-avatar">${(m.sender_name || '?')[0].toUpperCase()}</div>` : '<div style="width:32px"></div>'}
                <div class="msg-content">
                    ${!isMe && showAvatar ? `<div class="msg-sender">${m.sender_name || '未知'}</div>` : ''}
                    <div class="msg-bubble">
                        <div class="msg-text">${esc(m.content || '')}</div>
                        ${m.has_image ? `<img class="msg-img" src="/api/image/${m.id}" onclick="preview(this.src)" loading="lazy">` : ''}
                    </div>
                    <div class="msg-footer"><span class="msg-time">${ftime2(m.created_at)}</span></div>
                </div>
            </div>
        `;
    });
    
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
}

async function loadReqs() {
    const data = await load('requirements');
    state.reqs = data.requirements;
    renderReqs();
}

function renderReqs() {
    const el = document.getElementById('reqs');
    if (!el) return;
    
    if (!state.reqs.length) {
        el.innerHTML = '<div class="empty"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg><p>暂无需求</p></div>';
        return;
    }
    
    el.innerHTML = state.reqs.map(r => `
        <div class="req-item ${r.status === 'done' ? 'done' : ''} ${r.pinned ? 'pinned' : ''}"
             onclick="showReq(${r.id})"
             oncontextmenu="showReqCtx(event, ${r.id})">
            <div class="req-time">${fdatetime(r.created_at)}</div>
            <div class="req-text">${esc(r.content)}</div>
            ${r.status !== 'done' ? `<button class="req-check" onclick="event.stopPropagation(); quickDone(${r.id})">✓</button>` : ''}
        </div>
    `).join('');
}

async function quickDone(id) {
    await load(`requirements/${id}`, { method: 'PUT', body: { status: 'done' } });
    loadReqs();
}

let ctx = null;

function setupContextMenu() {
    ctx = document.getElementById('ctx');
    document.addEventListener('click', () => ctx.classList.remove('show'));
}

function setupModalClose() {
    let down = null;
    document.addEventListener('mousedown', e => {
        if (e.target.classList.contains('modal')) down = e.target;
    });
    document.addEventListener('mouseup', e => {
        if (down && e.target === down) down.classList.remove('show');
        down = null;
    });
}

function showCtx(e, items) {
    e.preventDefault();
    e.stopPropagation();
    ctx.innerHTML = items.map(i => {
        if (i.divider) return '<div class="ctx-divider"></div>';
        return `<div class="ctx-item ${i.danger ? 'danger' : ''}" onclick="ctx.classList.remove('show'); ${i.fn}">${i.label}</div>`;
    }).join('');
    ctx.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
    ctx.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`;
    ctx.classList.add('show');
}

function showChatCtx(e, id) {
    showCtx(e, [
        { label: '✓ 标记已读', fn: `markRead(${id})` },
        { divider: true },
        { label: '🗑 删除记录', fn: `delChat(${id})`, danger: true }
    ]);
}

function showMsgCtx(e, id) {
    showCtx(e, [
        { label: '📋 复制', fn: `copyMsg(${id})` },
        { divider: true },
        { label: '🗑 删除', fn: `delMsg(${id})`, danger: true }
    ]);
}

function showReqCtx(e, id) {
    const r = state.reqs.find(x => x.id === id);
    showCtx(e, [
        { label: r?.pinned ? '📌 取消置顶' : '📌 置顶', fn: `togglePin(${id})` },
        { label: r?.status === 'done' ? '⏱ 标记待处理' : '✓ 标记已处理', fn: `toggleStatus(${id})` },
        { divider: true },
        { label: '🗑 删除', fn: `delReq(${id})`, danger: true }
    ]);
}

async function delChat(id) {
    if (!confirm('确定删除？')) return;
    await load(`channels/${id}/messages`, { method: 'DELETE' });
    loadMsgs(state.chat);
}

function copyMsg(id) {
    const m = state.messages.find(x => x.id === id);
    if (m) navigator.clipboard.writeText(m.content || '');
}

async function delMsg(id) {
    await load(`messages/${id}`, { method: 'DELETE' });
    loadMsgs(state.chat);
}

function showReq(id) {
    const r = state.reqs.find(x => x.id === id);
    if (!r) return;
    document.getElementById('req-body').innerHTML = `
        <div style="margin-bottom:16px;font-size:13px;color:var(--text-2);">
            ${fdatetime(r.created_at)}
            <span style="margin-left:10px;padding:3px 10px;border-radius:12px;font-size:12px;background:${r.status === 'done' ? 'var(--success)' : 'var(--warning)'};color:#000;">
                ${r.status === 'done' ? '已处理' : '待处理'}
            </span>
        </div>
        <div style="font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(r.content)}</div>
    `;
    document.getElementById('req-foot').innerHTML = `
        <button class="btn btn-secondary" onclick="toggleStatus(${id}); hide('req-modal')">
            ${r.status === 'done' ? '标记待处理' : '标记已处理'}
        </button>
        <button class="btn btn-danger" onclick="delReq(${id})">删除</button>
    `;
    show('req-modal');
}

function newReq() {
    document.getElementById('req-input').value = '';
    show('add-req-modal');
}

async function addReq() {
    const txt = document.getElementById('req-input').value.trim();
    if (!txt) return;
    await load('requirements', { method: 'POST', body: { content: txt } });
    hide('add-req-modal');
    loadReqs();
}

async function toggleStatus(id) {
    const r = state.reqs.find(x => x.id === id);
    if (!r) return;
    await load(`requirements/${id}`, { method: 'PUT', body: { status: r.status === 'done' ? 'pending' : 'done' } });
    loadReqs();
}

async function togglePin(id) {
    const r = state.reqs.find(x => x.id === id);
    if (!r) return;
    await load(`requirements/${id}`, { method: 'PUT', body: { pinned: !r.pinned } });
    loadReqs();
}

async function delReq(id) {
    await load(`requirements/${id}`, { method: 'DELETE' });
    hide('req-modal');
    loadReqs();
}

async function send() {
    const input = document.getElementById('input');
    const txt = input.value.trim();
    if (!txt || !state.chat) return;
    
    try {
        const res = await load('send_message', {
            method: 'POST',
            body: { channel_id: state.chat, content: txt }
        });
        
        if (res.success) {
            input.value = '';
            state.messages.push({
                id: Date.now(),
                sender_name: 'Me',
                content: txt,
                created_at: new Date().toISOString(),
                is_outgoing: true
            });
            renderMsgs();
            setTimeout(() => loadMsgs(state.chat), 2000);
        } else {
            alert('发送失败: ' + (res.error || ''));
        }
    } catch (e) {
        alert('发送失败: ' + e.message);
    }
}

function ai() {
    const ctx = state.messages.slice(-5).map(m => `${m.sender_name}: ${m.content || ''}`).join('\n');
    document.getElementById('ai-ctx').value = ctx || '(无上下文)';
    document.getElementById('ai-out').value = '';
    show('ai-modal');
}

async function genAi() {
    const btn = event.target;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 生成中...';
    
    try {
        const res = await load('ai_assist', {
            method: 'POST',
            body: {
                context: document.getElementById('ai-ctx').value,
                model: state.settings.aiModel
            }
        });
        document.getElementById('ai-out').value = res.reply || '生成失败';
    } catch (e) {
        document.getElementById('ai-out').value = '生成失败: ' + e.message;
    }
    
    btn.disabled = false;
    btn.textContent = original;
}

function useAi() {
    const reply = document.getElementById('ai-out').value;
    if (reply) {
        document.getElementById('input').value = reply;
        hide('ai-modal');
    }
}

let settingsTab = 'channels';

async function openSettings() {
    switchTab('channels');
    await loadChannelsSettings();
    await loadModels();
    show('settings-modal');
}

function switchTab(tab) {
    settingsTab = tab;
    document.querySelectorAll('.settings-nav-item').forEach(t => 
        t.classList.toggle('active', t.dataset.tab === tab)
    );
    document.querySelectorAll('.settings-panel').forEach(p => 
        p.classList.toggle('active', p.id === `tab-${tab}`)
    );
}

async function loadChannelsSettings() {
    const data = await load('channels');
    const active = data.channels.filter(c => c.active);
    document.getElementById('channels-active').innerHTML = active.map(c => `
        <div class="channel-item">
            <span>${c.name}</span>
            <button class="btn btn-danger btn-sm" onclick="rmChannel(${c.id})">移除</button>
        </div>
    `).join('') || '<p style="color:var(--text-2);text-align:center;padding:20px;">暂无</p>';
}

async function loadModels() {
    try {
        const res = await fetch('http://localhost:11434/api/tags');
        const data = await res.json();
        document.getElementById('ai-model').innerHTML = data.models.map(m =>
            `<option value="${m.name}" ${m.name === state.settings.aiModel ? 'selected' : ''}>${m.name}</option>`
        ).join('');
    } catch {
        document.getElementById('ai-model').innerHTML = '<option>无法加载模型</option>';
    }
}

function saveModel() {
    state.settings.aiModel = document.getElementById('ai-model').value;
    saveSettings();
}

async function searchChannels(q) {
    const el = document.getElementById('channels-search');
    if (!q) { el.innerHTML = ''; return; }
    const data = await load('channels');
    const list = data.channels.filter(c => !c.active && c.name.toLowerCase().includes(q.toLowerCase()));
    el.innerHTML = list.slice(0, 8).map(c => `
        <div class="channel-result">
            <span>${c.name}</span>
            <button class="btn btn-primary btn-sm" onclick="addChannel(${c.id})">添加</button>
        </div>
    `).join('') || '<p style="color:var(--text-2);text-align:center;padding:12px;">未找到</p>';
}

async function refreshChannels() {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = '刷新中...';
    await load('refresh_channels', { method: 'POST' });
    searchChannels(document.getElementById('channel-q').value);
    btn.disabled = false;
    btn.textContent = '刷新';
}

async function addChannel(id) {
    await load(`channels/${id}/toggle`, { method: 'POST', body: { active: true } });
    loadChats();
    loadChannelsSettings();
    document.getElementById('channel-q').value = '';
    document.getElementById('channels-search').innerHTML = '';
}

async function rmChannel(id) {
    await load(`channels/${id}/toggle`, { method: 'POST', body: { active: false } });
    loadChats();
    loadChannelsSettings();
}

function onSearch(q) {
    clearTimeout(timer);
    timer = setTimeout(() => {
        if (q.trim() && state.chat) searchInChat(q);
        else if (!q.trim()) loadMsgs(state.chat);
    }, 300);
}

async function searchInChat(q) {
    const data = await load(`messages?channel_id=${state.chat}&q=${encodeURIComponent(q)}&limit=50`);
    state.messages = data.messages.reverse();
    renderMsgs();
}

function theme() {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = state.settings.theme;
    saveSettings();
}

function show(id) { document.getElementById(id).classList.add('show'); }
function hide(id) { document.getElementById(id).classList.remove('show'); }

function preview(src) {
    document.getElementById('preview-img').src = src;
    document.getElementById('preview').classList.add('show');
}

function ftime(s) {
    const d = new Date(s);
    const n = new Date();
    const diff = n - d;
    if (diff < 86400000 && d.getDate() === n.getDate()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fdate(s) {
    const d = new Date(s);
    const n = new Date();
    const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const mdate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = (today - mdate) / 86400000;
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function ftime2(s) {
    return new Date(s).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function fdatetime(s) {
    const d = new Date(s);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

function esc(t) {
    const div = document.createElement('div');
    div.textContent = t || '';
    return div.innerHTML;
}

const showAddReq = newReq;
const showSettings = openSettings;
const toggleTheme = theme;
const sendMessage = send;
const aiAssist = ai;
const generateAiReply = genAi;

init();
