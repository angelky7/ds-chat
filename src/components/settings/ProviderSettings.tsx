import { useState, type ReactNode } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { verifyApiKey } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import {
  activeProvider,
  PROVIDERS,
  resetProviderConfig,
  setActiveProvider,
  updateProviderConfig,
  useProviders,
  type ActiveProvider,
  type ProviderCapabilities,
  type ProviderId,
  type ProviderProtocol,
} from '../../services/providers.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconEditOutline16 } from '../base/icons.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './Provider.module.css'

/** 一行设置：标题在左，可选控件在标题右侧，输入框独占一行 */
const Field = ({
  label,
  hint,
  action,
  children,
}: {
  label: string
  hint?: string
  action?: ReactNode
  children?: ReactNode
}) => (
  <div className={styles.field}>
    <div className={styles.labelRow}>
      <span className={styles.label}>{label}</span>
      {action}
    </div>
    {children}
    {hint ? <div className={styles.hint}>{hint}</div> : null}
  </div>
)

/** 当前服务商实际可用的能力，用于说明为什么某些按钮消失了 */
const capabilityList = (capabilities: ProviderCapabilities, t: (key: TranslationKey) => string) => {
  const keys: TranslationKey[] = ['providerCapabilityChat']
  if (capabilities.images) {
    keys.push('providerCapabilityImages')
  }
  if (capabilities.search) {
    keys.push('providerCapabilitySearch')
  }
  if (capabilities.files) {
    keys.push('providerCapabilityFiles')
  }
  if (capabilities.speech) {
    keys.push('providerCapabilitySpeech')
  }
  return keys.map((key) => t(key)).join(' · ')
}

/** API Key：保存后只显示掩码，点编辑按钮才能重新输入 */
const KeyField = ({ provider }: { provider: ActiveProvider }) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const describe = (cause: unknown): string => {
    const kind = classifyApiError(cause)
    if (kind === 'unauthorized') {
      return t('apiKeyInvalid')
    }
    if (kind === 'network') {
      return t('commonNetworkErrorToast')
    }
    return t('apiKeyVerificationFailed', { message: cause instanceof Error ? cause.message : String(cause) })
  }

  const save = async () => {
    const apiKey = value.trim()
    if (!apiKey || saving) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      await verifyApiKey({ ...provider, apiKey })
      updateProviderConfig(provider.id, { apiKey })
      setValue('')
      setEditing(false)
    } catch (cause) {
      setError(describe(cause))
    } finally {
      setSaving(false)
    }
  }

  const saved = provider.apiKey !== ''
  return (
    <Field
      label={t('providerApiKey')}
      action={
        <a className={styles.link} href={provider.preset.keysUrl} target="_blank" rel="noreferrer">
          {t('providerApiKeyGet')}
        </a>
      }
    >
      {saved && !editing ? (
        <div className={styles.saved}>
          <span className={styles.mask}>{'*'.repeat(Math.min(provider.apiKey.length, 48))}</span>
          <span className={styles.savedHint}>{t('providerApiKeySaved')}</span>
          <IconButton
            tone="primary"
            icon={<IconEditOutline16 />}
            tooltip={t('apiKeyEdit')}
            onClick={() => setEditing(true)}
          />
        </div>
      ) : (
        <div className={styles.inputRow}>
          <input
            type="password"
            className={styles.input}
            placeholder={t('providerApiKeyPlaceholder', { name: provider.preset.label })}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                void save()
              }
            }}
          />
          <span className={styles.divider} />
          <button
            type="button"
            className={styles.confirm}
            disabled={!value.trim() || saving}
            onClick={() => void save()}
          >
            {saving ? t('apiKeyVerifying') : t('confirm')}
          </button>
        </div>
      )}
      {error ? <div className={styles.error}>{error}</div> : null}
    </Field>
  )
}

/** 模型服务：选择服务商，配置该服务商的 Key、地址、模型与协议 */
export const ProviderSettings = () => {
  const t = useTranslate()
  // 订阅整份配置，服务商、Key、地址、模型任一变化都重新渲染
  useProviders()
  const provider = activeProvider()
  const [resetted, setResetted] = useState(false)

  return (
    <div className={styles.wrap}>
      <Field label={t('providerService')} hint={t('providerServiceHint')}>
        <Select
          ariaLabel={t('providerService')}
          className={styles.select}
          value={provider.id}
          options={PROVIDERS.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(value) => {
            setActiveProvider(value as ProviderId)
            setResetted(false)
          }}
        />
      </Field>

      <KeyField key={provider.id} provider={provider} />

      <Field
        label={t('providerBaseUrl')}
        hint={t('providerBaseUrlHint', { url: provider.preset.baseUrl })}
      >
        <div className={styles.inputRow}>
          <input
            type="text"
            className={styles.input}
            spellCheck={false}
            autoComplete="off"
            placeholder={provider.preset.baseUrl}
            value={provider.config.baseUrl}
            onChange={(event) => {
              updateProviderConfig(provider.id, { baseUrl: event.target.value })
              setResetted(false)
            }}
          />
        </div>
      </Field>

      <Field label={t('providerModel')} hint={t('providerModelHint', { model: provider.preset.model })}>
        <div className={styles.inputRow}>
          <input
            type="text"
            className={styles.input}
            list={`provider-models-${provider.id}`}
            spellCheck={false}
            autoComplete="off"
            placeholder={provider.preset.model}
            value={provider.config.model}
            onChange={(event) => {
              updateProviderConfig(provider.id, { model: event.target.value })
              setResetted(false)
            }}
          />
          <datalist id={`provider-models-${provider.id}`}>
            {provider.preset.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </div>
      </Field>

      <Field label={t('providerProtocol')}>
        <Select
          ariaLabel={t('providerProtocol')}
          className={styles.select}
          value={provider.config.protocol || provider.protocol}
          options={[
            { value: 'anthropic', label: t('providerProtocolAnthropic') },
            { value: 'openai', label: t('providerProtocolOpenai') },
          ]}
          onChange={(value) =>
            updateProviderConfig(provider.id, {
              // 选回预设协议时存空串，后续跟随预设变化
              protocol: value === provider.preset.protocol ? '' : (value as ProviderProtocol),
            })
          }
        />
      </Field>

      <div className={styles.footer}>
        <div className={styles.caps}>
          {resetted
            ? t('providerResetDone')
            : t('providerCapabilities', { list: capabilityList(provider.capabilities, t) })}
        </div>
        <Button
          variant="outlined"
          size="m"
          onClick={() => {
            resetProviderConfig(provider.id)
            setResetted(true)
            showToast({ key: 'providerResetDone' })
          }}
        >
          {t('providerReset')}
        </Button>
      </div>
    </div>
  )
}
