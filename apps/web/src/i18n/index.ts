
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';
import es from './locales/es.json';

export const defaultNS = 'translation';
export const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
  es: { translation: es },
} as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'es',
    defaultNS,
    ns: [defaultNS],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'rp.lang',
    },
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });

export default i18n;

