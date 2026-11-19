import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { revealMessage } from '../../services/chat/store.js'
import { searchHistory, type SearchHit, type SearchResult } from '../../services/chat/searchHistory.js'
import { Modal } from '../base/Modal.js'
import { IconSearchOutline16 } from '../base/icons.js'
import { closeHistorySearch, useHistorySearch } from './historySearchState.js'
import styles from './HistorySearch.module.css'

const EMPTY: SearchResult = { titleHits: [], contentHits: [], truncated: false }

/** 命中部分加底色，大小写不敏感；不做正则，避免用户输入被当成模式 */
const Highlight = ({ text, query }: { text: string; query: string }) => {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return <>{text}</>
  }
  const parts: ReactNode[] = []
  const lower = text.toLowerCase()
  let cursor = 0
  let index = lower.indexOf(needle)
  let key = 0
  while (index >= 0) {
    if (index > cursor) {
      parts.push(text.slice(cursor, index))
    }
    parts.push(
      <mark key={key} className={styles.mark}>
        {text.slice(index, index + needle.length)}
      </mark>
    )
    key += 1
    cursor = index + needle.length
    index = lower.indexOf(needle, cursor)
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
  return <>{parts}</>
}

const HitButton = ({
  hit,
  query,
  onSelect,
}: {
  hit: SearchHit
  query: string
  onSelect: () => void
}) => {
  const t = useTranslate()
  return (
    <button type="button" className={styles.hit} onClick={onSelect}>
      <span className={styles.hitTitle}>
        <Highlight text={hit.title || t('untitledChat')} query={hit.snippet ? '' : query} />
      </span>
      {hit.snippet ? (
        <span className={styles.hitSnippet}>
          <Highlight text={hit.snippet} query={query} />
        </span>
      ) : null}
    </button>
  )
}

/** 历史搜索：一个输入框同时匹配会话标题与对话内容，点击结果跳到对应消息 */
export const HistorySearch = () => {
  const t = useTranslate()
  const open = useHistorySearch((state) => state.open)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult>(EMPTY)
  const [searching, setSearching] = useState(false)
  // 输入很快时只认最后一次请求的结果，避免先返回的旧结果覆盖新结果
  const seq = useRef(0)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResult(EMPTY)
      setSearching(false)
      seq.current += 1
    }
  }, [open])

  useEffect(() => {
    const needle = query.trim()
    if (!needle) {
      setResult(EMPTY)
      setSearching(false)
      return
    }
    const current = (seq.current += 1)
    setSearching(true)
    // 逐条读取会话正文，输入停顿后再查，避免每敲一个字都全量扫一遍
    const timer = setTimeout(() => {
      void searchHistory(needle)
        .then((next) => {
          if (seq.current === current) {
            setResult(next)
            setSearching(false)
          }
        })
        .catch(() => {
          if (seq.current === current) {
            setResult(EMPTY)
            setSearching(false)
          }
        })
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  if (!open) {
    return null
  }

  const select = (hit: SearchHit) => {
    revealMessage(hit.sessionId, hit.messageId)
    closeHistorySearch()
  }
  const total = result.titleHits.length + result.contentHits.length

  return (
    <Modal title={t('searchHistoryTitle')} onClose={closeHistorySearch} closable className={styles.dialog}>
      <div className={styles.body}>
        <label className={styles.field}>
          <IconSearchOutline16 />
          <input
            className={styles.input}
            autoFocus
            value={query}
            placeholder={t('searchHistoryPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={styles.results}>
          {!query.trim() ? (
            <div className={styles.hint}>{t('searchHistoryEmptyHint')}</div>
          ) : searching && total === 0 ? (
            <div className={styles.hint}>{t('searchHistorySearching')}</div>
          ) : total === 0 ? (
            <div className={styles.hint}>{t('searchHistoryNoResult')}</div>
          ) : (
            <>
              {result.titleHits.length > 0 ? (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>{t('searchHistorySectionTitle')}</div>
                  {result.titleHits.map((hit) => (
                    <HitButton key={`t-${hit.sessionId}`} hit={hit} query={query} onSelect={() => select(hit)} />
                  ))}
                </div>
              ) : null}
              {result.contentHits.length > 0 ? (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>{t('searchHistorySectionContent')}</div>
                  {result.contentHits.map((hit) => (
                    <HitButton
                      key={`c-${hit.messageId}`}
                      hit={hit}
                      query={query}
                      onSelect={() => select(hit)}
                    />
                  ))}
                </div>
              ) : null}
              {result.truncated ? (
                <div className={styles.hint}>{t('searchHistoryTruncated')}</div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
