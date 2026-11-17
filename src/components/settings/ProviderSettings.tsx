import { useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { verifyApiKey } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import {
  activeProvider,
  addCustomProvider,
  allProviders,
  isCustomProvider,
  isMounted,
  removeCustomProvider,
  resetProviderConfig,
  resolveProvider,
  updateProviderConfig,
  useProviders,
  type ActiveProvider,
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
const capabilityList = (provider: ActiveProvider, t: ReturnType<typeof useTranslate>) => {
  const list: string[] = [t('providerCapabilityChat')]
  if (provider.capabilities.images) {
    list.push(t('providerCapabilityImages'))
  }
  if (provider.capabilities.search) {
    list.push(t('providerCapabilitySearch'))
  }
  if (provider.capabilities.files) {
    list.push(t('providerCapabilityFiles'))
  }
  if (provider.capabilities.speech) {
    list.push(t('providerCapabilitySpeech'))
  }
  return list.join(' · ')
}

/** API Key：保存后只显示掩码，点编辑按钮才能重新输入 */
const KeyField = ({ provider }: { provider: ActiveProvider }) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 校验失败的原因类型：401 是无解，网络/跨域则可以「仍然保存」后到对话里验证
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyApiError> | null>(null)

  const describe = (cause: unknown): string => {
    const kind = classifyApiError(cause)
    if (kind === 'unauthorized') {
      return t('apiKeyInvalid')
    }
    if (kind === 'network') {
      return t('providerNetworkHint', { name: provider.preset.label })
    }
    return t('apiKeyVerificationFailed', {
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }

  /** 跳过校验直接写入：校验失败可能只是本机网络或跨域被拦，不宜挡住 Key 保存 */
  const commit = () => {
    updateProviderConfig(provider.id, { apiKey: value.trim() })
    setValue('')
    setEditing(false)
    setError(null)
    setErrorKind(null)
    showToast({ key: 'providerSaved' })
  }

  const save = async () => {
    const apiKey = value.trim()
    if (!apiKey || saving) {
      return
    }
    setSaving(true)
    setError(null)
    setErrorKind(null)
    try {
      await verifyApiKey({ ...provider, apiKey })
      commit()
    } catch (cause) {
      setErrorKind(classifyApiError(cause))
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
        provider.preset.keysUrl ? (
          <a className={styles.link} href={provider.preset.keysUrl} target="_blank" rel="noreferrer">
            {t('providerApiKeyGet')}
          </a>
        ) : null
      }
    >
      {saved && !editing ? (
        <div className={styles.saved}>
          <span className={styles.mask}>{'*'.repeat(Math.min(provider.apiKey.length, 48))}</span>
          <span className={styles.savedHint}>{t('providerMounted')}</span>
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
            {saving ? t('apiKeyVerifying') : t('providerSaveKey')}
          </button>
        </div>
      )}
      {error ? (
        <div className={styles.error}>
          <span className={styles.errorText}>{error}</span>
          {errorKind === 'unauthorized' ? null : (
            <button type="button" className={styles.errorAction} onClick={commit}>
              {t('providerSaveAnyway')}
            </button>
          )}
        </div>
      ) : null}
    </Field>
  )
}

/**
 * 地址、协议与模型列表：先在本地编辑，点「保存配置」一次性写入，
 * 避免边输入边覆盖正在使用的模型。
 */
const ConnectionEditor = ({ provider }: { provider: ActiveProvider }) => {
  const t = useTranslate()
  const [baseUrl, setBaseUrl] = useState(provider.config.baseUrl)
  const [protocol, setProtocol] = useState<ProviderProtocol>(provider.protocol)
  const [models, setModels] = useState<string[]>(provider.models)
  const [newModel, setNewModel] = useState('')

  const blocked = provider.preset.corsBlocked?.includes(protocol) ?? false

  const addModel = () => {
    const value = newModel.trim()
    if (!value || models.includes(value)) {
      return
    }
    setModels([...models, value])
    setNewModel('')
  }

  const save = () => {
    const list = models.map((model) => model.trim()).filter(Boolean)
    const sameAsPreset =
      list.length === provider.preset.models.length &&
      list.every((model, index) => model === provider.preset.models[index])
    const ok = updateProviderConfig(provider.id, {
      baseUrl: baseUrl.trim(),
      // 与预设完全一致时存空列表，之后跟随预设更新
      models: sameAsPreset ? [] : list,
      protocol: protocol === provider.preset.protocol ? '' : protocol,
    })
    showToast(ok ? { key: 'providerSaved' } : { key: 'promptSaveFailed', type: 'error' })
  }

  return (
    <>
      <Field label={t('providerBaseUrl')} hint={t('providerBaseUrlHint')}>
        <div className={styles.inputRow}>
          <input
            type="text"
            className={styles.input}
            spellCheck={false}
            autoComplete="off"
            placeholder={provider.preset.baseUrl}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>
      </Field>

      <Field label={t('providerProtocol')}>
        <Select
          ariaLabel={t('providerProtocol')}
          className={styles.select}
          value={protocol}
          options={[
            { value: 'anthropic', label: t('providerProtocolAnthropic') },
            { value: 'openai', label: t('providerProtocolOpenai') },
          ]}
          onChange={(value) => setProtocol(value as ProviderProtocol)}
        />
      </Field>

      {blocked ? <div className={styles.warning}>{t('providerCorsWarning')}</div> : null}

      <Field label={t('providerModels')} hint={t('providerModelsHint')}>
        <div className={styles.modelChips}>
          {models.map((model) => (
            <span key={model} className={styles.modelChip}>
              {model}
              <button
                type="button"
                aria-label={`${t('providerModelRemove')} ${model}`}
                onClick={() => setModels(models.filter((item) => item !== model))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className={styles.inputRow}>
          <input
            type="text"
            className={styles.input}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('providerModelAddPlaceholder')}
            value={newModel}
            onChange={(event) => setNewModel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                addModel()
              }
            }}
          />
          <span className={styles.divider} />
          <button
            type="button"
            className={styles.confirm}
            disabled={!newModel.trim()}
            onClick={addModel}
          >
            {t('providerModelAdd')}
          </button>
        </div>
      </Field>

      <div className={styles.footer}>
        <div className={styles.caps}>
          {t('providerCapabilities', { list: capabilityList(provider, t) })}
        </div>
        <div className={styles.footerActions}>
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              resetProviderConfig(provider.id)
              setBaseUrl('')
              setProtocol(provider.preset.protocol)
              setModels(provider.preset.models)
              showToast({ key: 'providerResetDone' })
            }}
          >
            {t('providerReset')}
          </Button>
          <Button variant="primary" size="m" onClick={save}>
            {t('providerSave')}
          </Button>
        </div>
      </div>
    </>
  )
}

/** 自定义服务商表单：名称、地址、协议与模型，提交后立即接入 */
const CustomProviderForm = ({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: ProviderId) => void }) => {
  const t = useTranslate()
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai')
  const [models, setModels] = useState('')

  const list = models
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
  const valid = label.trim() !== '' && /^https?:\/\//i.test(baseUrl.trim()) && list.length > 0

  const submit = () => {
    const id = addCustomProvider({ label, baseUrl, protocol, models: list })
    if (!id) {
      showToast({ key: 'providerCustomInvalid', type: 'error' })
      return
    }
    showToast({ key: 'providerSaved' })
    onCreated(id)
  }

  return (
    <div className={styles.customForm}>
      <Field label={t('providerCustomName')}>
        <input
          className={styles.input}
          spellCheck={false}
          autoComplete="off"
          maxLength={30}
          placeholder={t('providerCustomNamePlaceholder')}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <Field label={t('providerBaseUrl')} hint={t('providerCustomUrlHint')}>
        <input
          className={styles.input}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://api.example.com/v1"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </Field>
      <Field label={t('providerProtocol')}>
        <Select
          ariaLabel={t('providerProtocol')}
          className={styles.select}
          value={protocol}
          options={[
            { value: 'openai', label: t('providerProtocolOpenai') },
            { value: 'anthropic', label: t('providerProtocolAnthropic') },
          ]}
          onChange={(value) => setProtocol(value as ProviderProtocol)}
        />
      </Field>
      <Field label={t('providerModels')} hint={t('providerCustomModelsHint')}>
        <textarea
          className={styles.customModels}
          rows={2}
          spellCheck={false}
          placeholder="gpt-4o-mini, gpt-4o"
          value={models}
          onChange={(event) => setModels(event.target.value)}
        />
      </Field>
      <div className={styles.customActions}>
        <Button variant="outlined" size="m" onClick={onCancel}>
          {t('providerCustomCancel')}
        </Button>
        <Button variant="primary" size="m" disabled={!valid} onClick={submit}>
          {t('providerCustomAdd')}
        </Button>
      </div>
    </div>
  )
}

/** 模型服务：为每个服务商分别保存 Key、地址、协议与模型列表，可多家同时挂载 */
export const ProviderSettings = () => {
  const t = useTranslate()
  useProviders()
  const current = activeProvider()
  const [editingId, setEditingId] = useState<ProviderId>(current.id)
  const [creating, setCreating] = useState(false)
  // 编辑当前服务商时带上正在使用的模型，能力列表才能反映 V4-Pro 这类纯文本模型的限制
  const provider = resolveProvider(editingId, editingId === current.id ? current.model : undefined)
  const options = allProviders()

  return (
    <div className={styles.wrap}>
      <Field
        label={t('providerService')}
        hint={t('providerServiceHint')}
        action={
          creating ? null : (
            <div className={styles.headActions}>
              {isCustomProvider(editingId) ? (
                <button
                  type="button"
                  className={styles.dangerLink}
                  onClick={() => {
                    if (removeCustomProvider(editingId)) {
                      showToast({ key: 'providerCustomRemoved' })
                      setEditingId(activeProvider().id)
                    }
                  }}
                >
                  {t('providerCustomDelete')}
                </button>
              ) : null}
              <button type="button" className={styles.link} onClick={() => setCreating(true)}>
                {t('providerCustomNew')}
              </button>
            </div>
          )
        }
      >
        <Select
          ariaLabel={t('providerService')}
          className={styles.select}
          value={editingId}
          options={options.map((item) => ({
            value: item.id,
            label: `${item.label}${item.custom ? ` · ${t('providerCustomTag')}` : ''} · ${t(
              isMounted(item.id) ? 'providerMounted' : 'providerNotMounted'
            )}`,
          }))}
          onChange={(value) => setEditingId(value as ProviderId)}
        />
      </Field>

      {creating ? (
        <CustomProviderForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setEditingId(id)
          }}
        />
      ) : (
        <>
          <div className={styles.switchHint}>{t('providerSwitchHint')}</div>
          <KeyField key={`key-${editingId}`} provider={provider} />
          <ConnectionEditor key={`conn-${editingId}`} provider={provider} />
        </>
      )}
    </div>
  )
}
