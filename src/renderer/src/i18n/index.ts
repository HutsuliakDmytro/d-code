import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uk } from './uk'

export type Language = 'en' | 'uk'

/**
 * Translation lookup keyed by the English string itself.
 *
 * Keeping English as the key means the source stays readable without a
 * separate glossary, and a missing translation degrades to the original
 * wording instead of a bare identifier.
 */
const DICTIONARIES: Record<Language, Record<string, string>> = { en: {}, uk }

interface LanguageStore {
  language: Language
  setLanguage: (language: Language) => void
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({
      language: 'en',
      setLanguage: (language) => set({ language })
    }),
    { name: 'ccui-language' }
  )
)

/**
 * Translates a string, optionally interpolating `{name}` placeholders.
 *
 * Placeholders are named rather than positional because word order differs
 * between languages, and a positional format would silently scramble them.
 */
export function translate(
  language: Language,
  text: string,
  values?: Record<string, string | number>
): string {
  const translated = DICTIONARIES[language][text] ?? text
  if (!values) return translated

  return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  )
}

/** Returns a translator bound to the current language. */
export function useTranslate(): (
  text: string,
  values?: Record<string, string | number>
) => string {
  const language = useLanguageStore((s) => s.language)
  return (text, values) => translate(language, text, values)
}

/**
 * Translator for code that runs outside React.
 *
 * Formatting helpers and clipboard handling produce user-visible text but are
 * plain functions, so they cannot use the hook. Reading the store directly is
 * safe here: these calls happen during rendering or in response to an event,
 * never during module initialisation.
 */
export function tr(text: string, values?: Record<string, string | number>): string {
  return translate(useLanguageStore.getState().language, text, values)
}

/** Language names as written in the languages themselves. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  uk: 'Українська'
}
