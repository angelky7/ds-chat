import { getRegionName, provinces, regionCodes } from '../../services/location.js'
import { isChineseBrowser, setLocation, useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { Select } from '../base/Select.js'
import { SettingCell } from './SettingCell.js'
import styles from './Settings.module.css'

/** 省份 / 城市（中国浏览器）或国家地区选择器，桌面与移动端共用 */
export const LocationSelects = ({ className }: { className?: string }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <div className={className ?? styles.locationSelectors}>
      {isChineseBrowser() ? (
        <>
          <Select
            ariaLabel={t('settingsLocationProvince')}
            className={styles.provinceSelect}
            value={province?.code ?? ''}
            placeholder={t('settingsLocationProvince')}
            options={provinces.map((item) => ({ value: item.code, label: item.name }))}
            onChange={(value) => {
              if (value !== province?.code) {
                setLocation({ region: 'CN', province: value })
              }
            }}
          />
          <Select
            ariaLabel={t('settingsLocationCity')}
            className={styles.citySelect}
            value={province ? (location?.city ?? '') : ''}
            disabled={!province?.cities.length}
            placeholder={t('settingsLocationCity')}
            options={province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []}
            onChange={(value) => {
              if (province) {
                setLocation({ region: 'CN', province: province.code, city: value })
              }
            }}
          />
        </>
      ) : (
        <Select
          ariaLabel={t('settingsLocationRegion')}
          className={styles.regionSelect}
          value={location?.region ?? ''}
          placeholder={t('settingsLocationRegion')}
          options={regionCodes
            .map((code) => ({ value: code, label: getRegionName(code, locale) }))
            .sort((a, b) => a.label.localeCompare(b.label, locale))}
          onChange={(value) => setLocation({ region: value })}
        />
      )}
    </div>
  )
}

/** 桌面端的一行：位置信息的说明 + 选择器 */
export const LocationSetting = () => {
  const t = useTranslate()
  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={<LocationSelects />}
    />
  )
}
