import './globals.css'
import TopNav from './components/TopNav'
import VersionCheckBanner from './components/VersionCheckBanner'

export const metadata = {
  title: 'DentHub',
  description: '歯科医院とディーラーをつなぐ発注・在庫管理プラットフォーム',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <VersionCheckBanner />
        <TopNav />
        {children}
      </body>
    </html>
  )
}
