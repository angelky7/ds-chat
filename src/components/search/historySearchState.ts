import { create } from 'zustand'

/** 历史搜索弹窗：侧边栏入口与快捷键共用，一个搜索框同时搜标题和对话内容 */
export const useHistorySearch = create(() => ({ open: false }))

export const openHistorySearch = () => useHistorySearch.setState({ open: true })

export const closeHistorySearch = () => useHistorySearch.setState({ open: false })
