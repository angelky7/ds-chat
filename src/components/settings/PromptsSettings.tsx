import clsx from 'clsx'
import { useId, useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  addOpeningMessage,
  canRestorePrompt,
  createPrompt,
  DEEPSEEK_DEFAULT_PROMPT,
  duplicatePrompt,
  presetDisplayName,
  PROMPT_VARIABLES,
  removeOpeningMessage,
  removePrompt,
  resetPrompt,
  setActivePrompt,
  updateOpeningMessage,
  updatePrompt,
  usePrompts,
  type PromptVariable,
} from '../../services/prompts.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './Prompts.module.css'

const VARIABLE_LABEL: Record<PromptVariable, TranslationKey> = {
  cur_date: 'promptVarDate',
  cur_time: 'promptVarTime',
  cur_weekday: 'promptVarWeekday',
  model_name: 'promptVarModel',
  locale: 'promptVarLocale',
  location: 'promptVarLocation',
}

const notifySaveFailed = () => showToast({ key: 'promptSaveFailed', type: 'error' })

/** 提示词：多套预设，可编辑、复制、删除，内置预设可恢复 DeepSeek 默认 */
export const PromptsSettings = () => {
  const t = useTranslate()
  const presets = usePrompts((state) => state.presets)
  const activeId = usePrompts((state) => state.activeId)
  const [restoreOpened, setRestoreOpened] = useState(false)
  const [deleteOpened, setDeleteOpened] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const nameId = useId()
  const systemId = useId()

  const active = presets.find((preset) => preset.id === activeId) ?? presets[0]
  const name = presetDisplayName(active, t)

  const apply = (ok: boolean) => {
    if (!ok) {
      notifySaveFailed()
    }
  }

  /** 在光标处插入变量占位符；选区被替换，插入后光标停在占位符之后 */
  const insertVariable = (variable: PromptVariable) => {
    const token = `{{${variable}}}`
    const element = textareaRef.current
    const start = element?.selectionStart ?? active.system.length
    const end = element?.selectionEnd ?? start
    apply(
      updatePrompt(active.id, {
        system: active.system.slice(0, start) + token + active.system.slice(end),
      })
    )
    requestAnimationFrame(() => {
      if (element) {
        element.focus()
        element.selectionStart = element.selectionEnd = start + token.length
      }
    })
  }

  const addPreset = () => {
    const index = presets.filter((preset) => !preset.builtin).length + 1
    createPrompt(t('promptNewName', { index }))
  }

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <div className={styles.label}>{t('promptActive')}</div>
          <div className={styles.description}>{t('promptActiveDescription')}</div>
        </div>
        <div className={styles.headActions}>
          <Select
            value={activeId}
            ariaLabel={t('promptActive')}
            options={presets.map((preset) => ({
              value: preset.id,
              label: presetDisplayName(preset, t),
            }))}
            onChange={setActivePrompt}
          />
          <Button variant="outlined" size="m" className={styles.newButton} onClick={addPreset}>
            {t('promptNew')}
          </Button>
        </div>
      </div>
      <div className={clsx(styles.block, styles.nameRow)}>
        <label className={styles.fieldLabel} htmlFor={nameId}>
          {t('promptName')}
        </label>
        <input
          id={nameId}
          className={styles.input}
          value={active.builtin ? name : active.name}
          maxLength={40}
          readOnly={active.builtin}
          title={active.builtin ? t('promptNameBuiltinHint') : undefined}
          onChange={(event) => apply(updatePrompt(active.id, { name: event.target.value }))}
        />
      </div>
      <div className={styles.block}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor={systemId}>
            {t('promptSystem')}
          </label>
          {canRestorePrompt(active) ? (
            <button
              type="button"
              className={styles.link}
              onClick={() => setRestoreOpened(true)}
            >
              {t('promptRestore')}
            </button>
          ) : null}
        </div>
        <textarea
          id={systemId}
          ref={textareaRef}
          className={styles.textarea}
          rows={7}
          spellCheck={false}
          placeholder={DEEPSEEK_DEFAULT_PROMPT}
          value={active.system}
          onChange={(event) => apply(updatePrompt(active.id, { system: event.target.value }))}
        />
        <div className={styles.description}>{t('promptSystemDescription')}</div>
      </div>
      <div className={styles.block}>
        <div className={styles.fieldLabel}>{t('promptVariables')}</div>
        <div className={styles.chips}>
          {PROMPT_VARIABLES.map((variable) => (
            <button
              key={variable}
              type="button"
              className={styles.chip}
              onClick={() => insertVariable(variable)}
            >
              {`{{${variable}}}`}
              <span className={styles.chipLabel}>{t(VARIABLE_LABEL[variable])}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.block}>
        <div className={styles.fieldRow}>
          <div className={styles.fieldLabel}>{t('promptOpening')}</div>
          <button
            type="button"
            className={styles.link}
            onClick={() => apply(addOpeningMessage(active.id))}
          >
            {t('promptOpeningAdd')}
          </button>
        </div>
        {active.opening.length === 0 ? (
          <div className={styles.openingEmpty}>{t('promptOpeningEmpty')}</div>
        ) : (
          <div className={styles.openingList}>
            {active.opening.map((message) => (
              <div key={message.id} className={styles.openingItem}>
                <div className={styles.openingHead}>
                  <div className={styles.roles} role="group" aria-label={t('promptOpeningRole')}>
                    {(['user', 'assistant'] as const).map((role) => (
                      <button
                        key={role}
                        type="button"
                        className={clsx(
                          styles.roleButton,
                          message.role === role && styles.roleActive
                        )}
                        aria-pressed={message.role === role}
                        onClick={() => apply(updateOpeningMessage(active.id, message.id, { role }))}
                      >
                        {t(role === 'user' ? 'promptOpeningUser' : 'promptOpeningAssistant')}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => apply(removeOpeningMessage(active.id, message.id))}
                  >
                    {t('promptOpeningRemove')}
                  </button>
                </div>
                <textarea
                  className={styles.openingTextarea}
                  rows={2}
                  spellCheck={false}
                  aria-label={t('promptOpening')}
                  placeholder={t(
                    message.role === 'user'
                      ? 'promptOpeningUserPlaceholder'
                      : 'promptOpeningAssistantPlaceholder'
                  )}
                  value={message.content}
                  onChange={(event) =>
                    apply(
                      updateOpeningMessage(active.id, message.id, { content: event.target.value })
                    )
                  }
                />
              </div>
            ))}
          </div>
        )}
        <div className={styles.description}>{t('promptOpeningDescription')}</div>
      </div>
      <div className={styles.footer}>
        <div className={styles.hint}>
          {t('promptDefaultHint', { prompt: DEEPSEEK_DEFAULT_PROMPT })}
        </div>
        <div className={styles.footerActions}>
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              const id = duplicatePrompt(active.id, `${name} ${t('promptCopySuffix')}`)
              if (!id) {
                notifySaveFailed()
              }
            }}
          >
            {t('promptDuplicate')}
          </button>
          {active.builtin ? null : (
            <button
              type="button"
              className={clsx(styles.link, styles.danger)}
              onClick={() => setDeleteOpened(true)}
            >
              {t('promptDelete')}
            </button>
          )}
        </div>
      </div>
      {restoreOpened ? (
        <Modal
          title={t('promptRestoreConfirmTitle')}
          className={styles.confirm}
          onClose={() => setRestoreOpened(false)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setRestoreOpened(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="dangerOutlined"
                size="m"
                onClick={() => {
                  apply(resetPrompt(active.id))
                  setRestoreOpened(false)
                }}
              >
                {t('promptRestore')}
              </Button>
            </>
          }
        >
          <div>{t('promptRestoreConfirmDescription')}</div>
        </Modal>
      ) : null}
      {deleteOpened ? (
        <Modal
          title={t('promptDeleteConfirmTitle')}
          className={styles.confirm}
          onClose={() => setDeleteOpened(false)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setDeleteOpened(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                size="m"
                onClick={() => {
                  apply(removePrompt(active.id))
                  setDeleteOpened(false)
                }}
              >
                {t('promptDelete')}
              </Button>
            </>
          }
        >
          <div>{t('promptDeleteConfirmDescription', { name })}</div>
        </Modal>
      ) : null}
    </>
  )
}
