export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'seema-theme'

export function getSavedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch (error) {
    console.error('Unable to read saved appearance preference:', error)
    return 'light'
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'dark' ? '#171d19' : '#f8f8f5',
  )
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch (error) {
    console.error('Unable to save appearance preference:', error)
    throw new Error('Appearance preference could not be saved.')
  }
}

export function initializeTheme() {
  const theme = getSavedTheme()
  document.documentElement.dataset.theme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'dark' ? '#171d19' : '#f8f8f5',
  )
}
