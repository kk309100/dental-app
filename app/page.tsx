"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    router.push("/login")
  }, [router])

  return (
    <main style={{ padding: 20 }}>
      <p>ログイン画面へ移動中...</p>
    </main>
  )
}