import Link from 'next/link'
import './globals.css'

export const metadata = {
  title: '歯科注文アプリ',
  description: '歯科医院向け注文管理アプリ',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>
        <nav
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            padding: 12,
            background: '#111',
            color: '#fff',
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}
        >
          {/* 医院側のみ表示 */}
          <Link
            href="/"
            style={{ color: '#fff', textDecoration: 'none', fontWeight: 'bold' }}
          >
            注文
          </Link>

          <Link
            href="/history"
            style={{ color: '#fff', textDecoration: 'none', fontWeight: 'bold' }}
          >
            履歴
          </Link>
        </nav>

        {children}
      </body>
    </html>
  )
}
