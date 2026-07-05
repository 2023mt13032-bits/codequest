import { useEffect, useState } from 'react'

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])
  const toggle = () => setTheme(t => (t === 'light' ? 'dark' : 'light'))
  return [theme, toggle]
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme()
  return (
    <button className="btn sm theme-toggle" onClick={toggle}
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
      {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
    </button>
  )
}