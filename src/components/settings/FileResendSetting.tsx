import { useTranslate } from '../../i18n/index.js'
import { setFileResend, useSettings, type FileResend } from '../../services/settings.js'
import { Select } from '../base/Select.js'
import { SettingCell } from './SettingCell.js'

/**
 * 历史附件重发方式：默认只在发送的那一轮带文件。
 * 每轮重发会把上下文窗口内的文档与图片反复带上，token 随轮次增长，换来文件不会被"忘掉"。
 */
export const FileResendSetting = () => {
  const t = useTranslate()
  const fileResend = useSettings((state) => state.fileResend)
  return (
    <SettingCell
      label={t('settingsFileResend')}
      description={t('settingsFileResendDescription')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsFileResend')}
          value={fileResend}
          options={[
            { value: 'once', label: t('settingsFileResendOnce') },
            { value: 'every-turn', label: t('settingsFileResendEveryTurn') },
          ]}
          onChange={(value) => setFileResend(value as FileResend)}
        />
      }
    />
  )
}
