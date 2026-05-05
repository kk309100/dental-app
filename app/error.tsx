"use client"

import { useEffect } from "react"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[GlobalError]", error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="max-w-md bg-white rounded-lg shadow p-8 text-center">
        <div className="text-5xl mb-3">😵</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">エラーが発生しました</h1>
        <p className="text-sm text-gray-600 mb-1">画面の表示中に問題が起きました。</p>
        <p className="text-xs text-gray-400 mb-4 font-mono break-all">{error.message}</p>
        {error.digest && <p className="text-[10px] text-gray-400 mb-4">ID: {error.digest}</p>}
        <div className="flex items-center justify-center gap-2">
          <button onClick={reset} className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded hover:bg-emerald-700">
            再読み込み
          </button>
          <a href="/admin" className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200">
            ホームへ
          </a>
        </div>
      </div>
    </div>
  )
}
