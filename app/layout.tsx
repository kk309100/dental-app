import './globals.css'
import TopNav from './components/TopNav'

export const metadata = {
  title: '歯科注文アプリ',
  description: '歯科医院向け注文管理アプリ',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>
        <TopNav />
        {children}
      </body>
    </html>
  )
}
