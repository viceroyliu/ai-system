export const state = {
  chat: null,
  chats: [],
  messages: [],
  reqs: [],
  settings: {
    theme: 'dark',
    read: {},
    aiModel: 'qwen2.5:14b-instruct',
    aiPrompt: '你是专业助手，生成简洁回复（50字内）：',
    requirementChannels: [2333658668]
  },
  online: false,
  myUserId: null,
  selectedMsgs: new Set(),
  lastSelectedIndex: -1,
  lastMsgId: null,
  collapsedGroups: new Set()
}

export function resetSelection() {
  state.selectedMsgs.clear()
  state.lastSelectedIndex = -1
}
