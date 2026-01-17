import { zh } from '../locales/zh';
import { en } from '../locales/en';
import { getRuntime, updateRuntime, type Locale } from '../core/runtime';

export type { Locale };
export type Messages = typeof zh;

const messages: Record<Locale, Messages> = { zh, en };

/**
 * 检测系统语言
 */
export const detectSystemLocale = (): Locale => {
  // 使用 Intl API
  try {
    const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (systemLocale.toLowerCase().startsWith('zh')) {
      return 'zh';
    } else {
      return 'en';
    }
  } catch {
    // Intl API 不可用时回退到环境变量
  }

  const envLang =
    process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '';

  if (envLang.toLowerCase().startsWith('zh')) {
    return 'zh';
  } else {
    return 'en';
  }
};

/**
 * 初始化 i18n，自动检测系统语言并更新到运行时配置
 */
export const initI18n = (locale?: Locale): void => {
  const detectedLocale = locale ?? detectSystemLocale();
  updateRuntime({ locale: detectedLocale });
};

/**
 * 设置当前语言
 */
export const setLocale = (locale: Locale): void => {
  updateRuntime({ locale });
};

/**
 * 获取当前语言
 */
export const getLocale = (): Locale => getRuntime().locale;

/**
 * 获取翻译文本
 * 支持模板字符串替换，如: t('hello', { name: 'World' }) => "Hello, World"
 */
export const t = (
  key: keyof Messages,
  params?: Record<string, string | number>,
): string => {
  const currentLocale = getRuntime().locale;
  let text = messages[currentLocale][key] || messages['en'][key] || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
};

export default { t, setLocale, getLocale, initI18n, detectSystemLocale };
