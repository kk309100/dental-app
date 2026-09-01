"use client"

// 新着注文アラート（管理画面を開いている間、音＋ブラウザ通知で知らせる）
// - Supabase Realtime で orders テーブルの INSERT を購読
// - 音は Web Audio API でビープ音を生成（音声ファイル不要）
// - ブラウザ通知は初回、ユーザーの許可が必要（🔔ボタンから許可をリクエスト）

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"

const PERMISSION_KEY = "denthub_order_alert_enabled"

export default function OrderAlert() {
  const [enabled, setEnabled] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    // 前回のON/OFF状態を復元（通知許可が下りている場合のみ）
    const saved = localStorage.getItem(PERMISSION_KEY) === "1"
    if (saved && typeof Notification !== "undefined" && Notification.permission === "granted") {
      setEnabled(true)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel("admin-order-alert")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          playBeep()
          const dn = (payload.new as any)?.delivery_number || ""
          showBrowserNotification(dn)
          setToast(`📥 新着注文が入りました${dn ? `（${dn}）` : ""}`)
          setTimeout(() => setToast(null), 8000)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [enabled])

  function playBeep() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      const now = ctx.currentTime
      // ピンポン風の2音
      ;[880, 1108].forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "sine"
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, now + i * 0.18)
        gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.32)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now + i * 0.18)
        osc.stop(now + i * 0.18 + 0.35)
      })
    } catch { /* 音声再生に失敗しても通知自体は継続 */ }
  }

  function showBrowserNotification(deliveryNumber: string) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return
    try {
      new Notification("DentHub 新着注文", {
        body: deliveryNumber ? `注文番号: ${deliveryNumber}` : "新しい注文が届きました",
        icon: "/favicon.ico",
      })
    } catch { /* 通知失敗は無視 */ }
  }

  async function toggleEnabled() {
    if (enabled) {
      setEnabled(false)
      localStorage.setItem(PERMISSION_KEY, "0")
      return
    }
    if (typeof Notification === "undefined") {
      alert("お使いのブラウザは通知に対応していません。音のみ有効にします。")
      setEnabled(true)
      localStorage.setItem(PERMISSION_KEY, "1")
      return
    }
    if (Notification.permission === "granted") {
      setEnabled(true)
      localStorage.setItem(PERMISSION_KEY, "1")
      return
    }
    if (Notification.permission === "denied") {
      alert("ブラウザの通知がブロックされています。ブラウザの設定から通知を許可してください（音のみ有効にします）。")
      setEnabled(true)
      localStorage.setItem(PERMISSION_KEY, "1")
      return
    }
    const perm = await Notification.requestPermission()
    if (perm === "granted") {
      setEnabled(true)
      localStorage.setItem(PERMISSION_KEY, "1")
    } else {
      setEnabled(true) // 通知は拒否されたが音だけは有効にする
      localStorage.setItem(PERMISSION_KEY, "1")
    }
  }

  return (
    <>
      {/* ON/OFF トグルボタン（フィードバックボタンの上に配置） */}
      <div className="no-print" style={{ position: "fixed", right: 16, bottom: 138, zIndex: 40 }}>
        <button
          onClick={toggleEnabled}
          title={enabled ? "新着注文アラート：ON（クリックでOFF）" : "新着注文アラート：OFF（クリックでON）"}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: 999,
            background: enabled ? "#059669" : "#9ca3af",
            color: "#fff", border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 700,
            boxShadow: enabled ? "0 4px 16px rgba(5,150,105,0.4)" : "0 4px 16px rgba(0,0,0,0.15)",
          }}>
          {enabled ? "🔔 注文アラートON" : "🔕 注文アラートOFF"}
        </button>
      </div>

      {/* 新着注文トースト */}
      {toast && (
        <div className="no-print" style={{
          position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
          zIndex: 60, background: "#059669", color: "#fff",
          padding: "12px 22px", borderRadius: 12, fontSize: 14, fontWeight: 700,
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}>
          {toast}
        </div>
      )}
    </>
  )
}
