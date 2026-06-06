import './globals.css'
import TopNav from './components/TopNav'

export const metadata = {
  title: 'DentHub',
  description: '歯科医院とディーラーをつなぐ発注・在庫管理プラットフォーム',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <TopNav />
        {children}
      </body>
    </html>
  )
}
