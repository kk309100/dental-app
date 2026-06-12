"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { supabase, fetchAll } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode"
import { playBeep } from "@/lib/beep"

const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.QR_CODE,
]
import {
  Search, ShoppingCart, X, ScanLine, Heart, Package,
  ChevronLeft, ChevronUp, Minus, Plus, Trash2,
} from "lucide-react"

// ─── カラーパレット ───────────────────────────────────────
const C = {
  primary:    "#059669",
  primaryBg:  "#ecfdf5",
  primaryBdr: "#a7f3d0",
  accent:     "#ea580c",
  confirm:    "#dc2626",
  text:       "#111827",
  sub:        "#6b7280",
  border:     "#f3f4f6",
  borderMid:  "#e5e7eb",
  card:       "#ffffff",
  pageBg:     "#f8fafc",
}

type Notice = { id: string; title: string; body: string | null }

export default function OrderPage() {
  const router = useRouter()

  const [products, setProducts]               = useState<any[]>([])
  const [orders, setOrders]                   = useState<any[]>([])
  const [orderItems, setOrderItems]           = useState<any[]>([])
  const [cart, setCart]                       = useState<any[]>([])
  const [clinicId, setClinicId]               = useState("")
  const [clinicName, setClinicName]           = useState("")
  const [search, setSearch]                   = useState("")
  const [category, setCategory]               = useState("すべて")
  const [loading, setLoading]                 = useState(true)
  const [scanning, setScanning]               = useState(false)
  const [showCart, setShowCart]               = useState(false)
  const [showConfirm, setShowConfirm]         = useState(false)
  const [showComplete, setShowComplete]       = useState(false)
  const [lastOrderId, setLastOrderId]         = useState("")
  const [favorites, setFavorites]             = useState<string[]>([])
  const [notices, setNotices]                 = useState<Notice[]>([])
  const [dismissed, setDismissed]             = useState<string[]>([])
  const [ordererName, setOrdererName]         = useState("")
  const [orderNote, setOrderNote]             = useState("")
  const [lastOrdererName, setLastOrdererName] = useState("")
  const [showTopBtn, setShowTopBtn]           = useState(false)

  const scannerRef  = useRef<any>(null)
  const lastScanRef = useRef<{ code: string; time: number }>({ code: "", time: 0 })

  // overflow-x を body に設定
  useEffect(() => {
    document.body.style.overflowX = "hidden"
    return () => { document.body.style.overflowX = "" }
  }, [])

  // スクロール量に応じて TOP ボタン表示
  useEffect(() => {
    const onScroll = () => setShowTopBtn(window.scrollY > 300)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // カメラ起動中はページスクロールを固定
  useEffect(() => {
    document.body.style.overflow = scanning ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [scanning])

  useEffect(() => { checkLogin() }, [])

  async function checkLogin() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }
    setClinicId(profile.clinic_id)

    const [clinicRes, prods] = await Promise.all([
      supabase.from("clinics").select("*").eq("id", profile.clinic_id).single(),
      fetchAll("products", "*", (q) => q.eq("active", true).order("name", { ascending: true })),
    ])
    setClinicName(clinicRes.data?.name || "")
    setProducts(prods || [])
    setLoading(false)

    fetchOrderHistory(profile.clinic_id)
    fetchFavorites(profile.clinic_id)
    fetchNotices()
  }

  async function fetchOrderHistory(cid: string) {
    const { data: o } = await supabase.from("orders").select("*").eq("clinic_id", cid)
      .order("created_at", { ascending: false }).limit(200)
    const ords = (o as any[]) || []
    setOrders(ords)
    if (ords.length === 0) return
    const ids = ords.slice(0, 50).map((x: any) => x.id)
    const { data: i } = await supabase.from("order_items").select("*").in("order_id", ids)
    setOrderItems((i as any[]) || [])
  }

  async function fetchFavorites(cid: string) {
    const { data } = await supabase.from("favorites").select("product_id").eq("clinic_id", cid)
    setFavorites((data || []).map((f: any) => f.product_id))
  }

  async function fetchNotices() {
    const { data } = await supabase.from("notices").select("*").eq("is_active", true).order("created_at", { ascending: false })
    setNotices(data || [])
  }

  async function toggleFavorite(productId: string) {
    if (favorites.includes(productId)) {
      setFavorites((prev) => prev.filter((id) => id !== productId))
      await supabase.from("favorites").delete().eq("clinic_id", clinicId).eq("product_id", productId)
    } else {
      setFavorites((prev) => [...prev, productId])
      await supabase.from("favorites").insert([{ clinic_id: clinicId, product_id: productId }])
    }
  }

  const norm = (v: any) => {
    const s = String(v || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")
    return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
  }

  const categories = useMemo(() => {
    const list = products.map((p) => p.category).filter((c) => c && String(c).trim())
    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const filteredProducts = useMemo(() => {
    const k = norm(search)
    return products.filter((p) => {
      const t = norm(`${p.name} ${p.product_code || ""} ${p.manufacturer || ""} ${p.barcode || ""} ${p.purchase_maker || ""}`)
      return (!k || t.includes(k)) && (category === "すべて" || p.category === category)
    })
  }, [products, search, category])

  const favoriteProducts = useMemo(() => products.filter((p) => favorites.includes(p.id)), [products, favorites])

  const frequentProducts = useMemo(() => {
    const ids = orders.map((o) => o.id)
    const map: Record<string, number> = {}
    orderItems.filter((i) => ids.includes(i.order_id))
      .forEach((i) => { map[i.product_id] = (map[i.product_id] || 0) + Number(i.quantity || 0) })
    return products.map((p) => ({ ...p, used_count: map[p.id] || 0 }))
      .filter((p) => p.used_count > 0 && !favorites.includes(p.id))
      .sort((a, b) => b.used_count - a.used_count).slice(0, 8)
  }, [products, orders, orderItems, favorites])

  const recentProducts = useMemo(() => {
    const ids = Array.from(new Set(
      orderItems.filter((i) => orders.slice(0, 10).map((o) => o.id).includes(i.order_id)).map((i) => i.product_id)
    )).slice(0, 8)
    return ids.map((id) => products.find((p) => p.id === id)).filter(Boolean)
      .filter((p: any) => !favorites.includes(p.id))
  }, [products, orders, orderItems, favorites])

  // O(1) バーコードルックアップ用 Map
  const barcodeMap = useMemo(() => {
    const m = new Map<string, any>()
    for (const p of products) {
      if (p.barcode)       m.set(String(p.barcode), p)
      if (p.product_code)  m.set(String(p.product_code), p)
    }
    return m
  }, [products])

  // よく使う + 最近注文 を統合（重複を除去）
  const quickProducts = useMemo(() => {
    const freqIds = new Set(frequentProducts.map((p) => p.id))
    return [
      ...frequentProducts,
      ...recentProducts.filter((p: any) => !freqIds.has(p.id)),
    ].slice(0, 10)
  }, [frequentProducts, recentProducts])

  function addToCart(product: any) {
    setCart((prev) => {
      const ex = prev.find((i) => i.id === product.id)
      if (ex) return prev.map((i) => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { ...product, quantity: 1 }]
    })
  }
  function decreaseQty(id: string) {
    setCart((prev) => prev.map((i) => i.id === id ? { ...i, quantity: i.quantity - 1 } : i).filter((i) => i.quantity > 0))
  }
  function increaseQty(id: string) {
    setCart((prev) => prev.map((i) => i.id === id ? { ...i, quantity: i.quantity + 1 } : i))
  }
  function setQty(id: string, val: string) {
    const q = Number(val); if (isNaN(q) || q < 0) return
    setCart((prev) => prev.map((i) => i.id === id ? { ...i, quantity: q } : i).filter((i) => i.quantity > 0))
  }
  function removeItem(id: string) { setCart((prev) => prev.filter((i) => i.id !== id)) }

  async function startScan() {
    setScanning(true)
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const scanner = new Html5Qrcode("reader")
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: { width: 280, height: 100 },
          aspectRatio: 1.777778,
          formatsToSupport: SCAN_FORMATS,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        },
        (code) => {
          const now = Date.now()
          if (code === lastScanRef.current.code && now - lastScanRef.current.time < 2000) return
          lastScanRef.current = { code, time: now }

          const p = barcodeMap.get(code)
          if (!p) {
            playBeep("error")
            alert(`「${code}」に一致する商品が見つかりません`)
            return
          }
          playBeep("success")
          if (typeof navigator.vibrate === "function") navigator.vibrate(60)
          addToCart(p)
          // カメラは継続（手動で閉じるまでスキャン可能）
        }, () => {})
    } catch (e) {
      scannerRef.current = null
      setScanning(false)
    }
  }

  async function stopScan() {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); scannerRef.current.clear() } catch (_) {}
      scannerRef.current = null
    }
    setScanning(false)
  }

  async function submitOrder() {
    if (!clinicId || cart.length === 0) return
    if (!ordererName.trim()) { alert("注文者名を入力してください。"); return }
    const total = cart.reduce((s, i) => s + Number(i.price || 0) * i.quantity, 0)
    const now = new Date()
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0")
    const { data: ex } = await supabase.from("orders").select("id").gte("created_at", `${y}-${m}-${d}T00:00:00`).lte("created_at", `${y}-${m}-${d}T23:59:59`)
    const dn = `DN-${y}${m}${d}-${String((ex?.length || 0) + 1).padStart(4, "0")}`
    const { data: order, error } = await supabase.from("orders")
      .insert([{ clinic_id: clinicId, status: "注文受付", total_price: total, delivery_number: dn, orderer_name: ordererName.trim(), note: orderNote.trim() || null }]).select().single()
    if (error) { alert("注文作成でエラー"); return }
    await supabase.from("order_items").insert(
      cart.map((i) => ({ order_id: order.id, product_id: i.id, product_name: i.name, quantity: i.quantity, price: i.price }))
    )
    setLastOrdererName(ordererName.trim())
    setLastOrderId(order.id)
    setCart([]); setOrdererName(""); setOrderNote("")
    setShowConfirm(false); setShowCart(false); setShowComplete(true)
    fetchOrderHistory(clinicId)
  }

  function changeCategory(c: string) {
    setCategory(c)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const totalPrice = cart.reduce((s, i) => s + Number(i.price || 0) * i.quantity, 0)
  const totalQty   = cart.reduce((s, i) => s + i.quantity, 0)
  const visibleNotices = notices.filter((n) => !dismissed.includes(n.id))

  // ─── ローディング ──────────────────────────────────────────
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: C.primary, borderRadius: "50%", margin: "0 auto 12px", animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>読み込み中…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  // ─── メイン ────────────────────────────────────────────────
  return (
    <main style={{
      maxWidth: 1080, margin: "0 auto",
      background: C.pageBg, minHeight: "100vh",
      overflowX: "hidden",
      paddingBottom: cart.length > 0 ? 96 : 40,
    }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── 横スクロールセクション ── */
        .hscroll {
          display: flex; gap: 10px;
          overflow-x: auto; overflow-y: visible;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
          padding: 4px 16px 12px;
        }
        .hscroll::-webkit-scrollbar { display: none; }

        /* ── ミニカード ── */
        .mini-card {
          width: calc(48vw - 16px);
          max-width: 200px;
          min-width: 130px;
          flex-shrink: 0;
          background: #fff;
          border-radius: 16px;
          border: 1px solid #f0f0f0;
          overflow: hidden;
          box-shadow: 0 1px 8px rgba(0,0,0,0.05);
          transition: transform 0.12s;
        }
        .mini-card:active { transform: scale(0.97); }

        /* ── 商品グリッド ── */
        .product-grid {
          display: flex; flex-direction: column; gap: 10px;
        }
        @media (min-width: 580px) {
          .product-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
          .mini-card { max-width: 180px; }
        }
        @media (min-width: 1100px) {
          .product-grid { grid-template-columns: repeat(3, 1fr); }
        }

        /* ── 商品カード ── */
        .product-card {
          background: #fff; border-radius: 16px;
          border: 1px solid #f0f0f0;
          overflow: hidden;
          box-shadow: 0 1px 6px rgba(0,0,0,0.04);
          animation: fadeUp 0.2s ease both;
          content-visibility: auto;
          contain-intrinsic-size: auto 220px;
        }
        .add-btn { transition: transform 0.1s, box-shadow 0.1s; }
        .add-btn:active { transform: scale(0.96); box-shadow: none !important; }

        /* ── PC カテゴリサイドバー ── */
        .cat-sidebar { display: none; }
        @media (min-width: 768px) {
          .cat-sidebar {
            display: flex; flex-direction: column;
            width: 160px; flex-shrink: 0;
            background: #fff;
            border-right: 1px solid #f3f4f6;
            position: sticky; top: 115px;
            align-self: flex-start;
            max-height: calc(100vh - 115px);
            overflow-y: auto;
          }
          .cat-sidebar::-webkit-scrollbar { width: 3px; }
          .cat-sidebar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 4px; }
          .cat-pills-section { display: none !important; }
        }

        /* ── カート下部バー ── */
        .cart-bar {
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 50;
          background: rgba(255,255,255,0.97);
          backdrop-filter: blur(16px);
          border-top: 1px solid #f0f0f0;
          box-shadow: 0 -4px 24px rgba(0,0,0,0.08);
          display: flex; align-items: center; gap: 12px;
          padding: 11px 16px;
          padding-bottom: calc(11px + env(safe-area-inset-bottom, 0px));
        }
      `}</style>

      {/* ════════════════════════════════════════════════════
          STICKY ヘッダー（2段）
      ════════════════════════════════════════════════════ */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "#fff",
        borderBottom: `1px solid ${C.border}`,
        boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
      }}>
        {/* ── 1段目：戻る | タイトル | カート ── */}
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", gap: 8 }}>
          <button onClick={() => router.push("/menu")} style={{
            display: "flex", alignItems: "center", gap: 3,
            padding: "8px 12px", borderRadius: 10,
            background: C.primaryBg, border: `1.5px solid ${C.primaryBdr}`,
            color: C.primary, fontSize: 13, fontWeight: 700,
            cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
          }}>
            <ChevronLeft size={15} color={C.primary} strokeWidth={2.5} />
            メニュー
          </button>

          <span style={{
            flex: 1, textAlign: "center",
            fontSize: 15, fontWeight: 700, color: C.text,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            注文する
          </span>

          {/* カートボタン（バッジ付き） */}
          <button onClick={() => setShowCart(true)} style={{
            position: "relative",
            display: "flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: 10,
            background: cart.length > 0 ? C.primary : "#f3f4f6",
            border: "none",
            color: cart.length > 0 ? "#fff" : C.sub,
            fontSize: 13, fontWeight: 700,
            cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
            boxShadow: cart.length > 0 ? "0 2px 8px rgba(5,150,105,0.30)" : "none",
            transition: "background 0.2s",
          }}>
            <ShoppingCart size={15} strokeWidth={2} />
            カート
            {totalQty > 0 && (
              <span style={{
                position: "absolute", top: -5, right: -5,
                background: "#ef4444", color: "#fff",
                fontSize: 10, fontWeight: 800,
                width: 17, height: 17, lineHeight: "17px",
                borderRadius: "50%", textAlign: "center",
              }}>{totalQty > 9 ? "9+" : totalQty}</span>
            )}
          </button>
        </div>

        {/* ── 2段目：検索バー ── */}
        <div style={{ padding: "0 14px 12px" }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <Search size={16} color={search ? C.primary : "#b0b8c1"} strokeWidth={2} />
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="商品名・コード・メーカーで検索"
              style={{
                width: "100%", padding: "11px 44px 11px 38px",
                borderRadius: 12, border: `1.5px solid ${search ? C.primaryBdr : C.borderMid}`,
                fontSize: 14, outline: "none",
                color: C.text, background: search ? "#fafffd" : "#f9fafb",
                transition: "border-color 0.15s",
              }}
            />
            {search && (
              <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "#fff",
                  background: filteredProducts.length > 0 ? C.primary : "#9ca3af",
                  borderRadius: 999, padding: "2px 8px",
                }}>
                  {filteredProducts.length}件
                </span>
                <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}>
                  <X size={15} color="#9ca3af" strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════
          カメラスキャン オーバーレイ
      ════════════════════════════════════════════════════ */}
      {scanning && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "#000", display: "flex", flexDirection: "column" }}>
          <button onClick={stopScan} style={{
            padding: "14px 0", background: "#ef4444", color: "#fff",
            border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            flexShrink: 0,
          }}>
            <X size={18} color="#fff" strokeWidth={2.5} />
            スキャンを停止
          </button>
          <div id="reader" style={{ flex: 1, width: "100%" }} />
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          メインレイアウト
      ════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", alignItems: "flex-start" }}>

        {/* ── PC カテゴリサイドバー ── */}
        <div className="cat-sidebar">
          {categories.map((c: any) => (
            <button key={c} onClick={() => changeCategory(c)} style={{
              padding: "11px 14px", textAlign: "left", fontSize: 13,
              cursor: "pointer", width: "100%", border: "none",
              fontWeight: category === c ? 700 : 400,
              background: category === c ? C.primaryBg : "transparent",
              color: category === c ? C.primary : C.text,
              borderLeft: `3px solid ${category === c ? C.primary : "transparent"}`,
              borderBottom: `1px solid ${C.border}`,
            }}>
              {c}
            </button>
          ))}
        </div>

        {/* ── コンテンツエリア ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* 医院名 + カテゴリ pills + スキャンボタン（padding あり） */}
          <div style={{ padding: "14px 16px 4px" }}>
            {clinicName && (
              <p style={{ margin: "0 0 12px", fontSize: 12, color: C.sub, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 14 }}>🏥</span> {clinicName}
              </p>
            )}

            {/* カテゴリ pills（モバイルのみ） */}
            <div className="cat-pills-section" style={{ marginBottom: 10 }}>
              <div style={{
                display: "flex", gap: 7, overflowX: "auto",
                scrollbarWidth: "none" as const,
                marginLeft: -16, marginRight: -16,
                paddingLeft: 16, paddingRight: 16, paddingBottom: 4,
              }}>
                {categories.map((c: any) => (
                  <button key={c} onClick={() => changeCategory(c)} style={{
                    flexShrink: 0, padding: "6px 14px", borderRadius: 999, fontSize: 13,
                    cursor: "pointer", fontWeight: category === c ? 700 : 500,
                    background: category === c ? C.primary : "#f3f4f6",
                    color: category === c ? "#fff" : C.sub,
                    border: `1.5px solid ${category === c ? C.primary : "transparent"}`,
                    whiteSpace: "nowrap", transition: "all 0.1s",
                  }}>{c}</button>
                ))}
              </div>
            </div>

            {/* バーコードスキャンボタン */}
            <button onClick={startScan} style={{
              width: "100%", padding: "11px 0", borderRadius: 12, marginBottom: 4,
              background: "#eff6ff", color: "#1d4ed8",
              border: "1.5px solid #bfdbfe",
              fontWeight: 700, fontSize: 14, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              <ScanLine size={17} strokeWidth={2} />
              バーコードでカートに追加
            </button>
          </div>

          {/* お知らせ */}
          {visibleNotices.length > 0 && (
            <div style={{ padding: "8px 16px 0" }}>
              {visibleNotices.map((n) => (
                <div key={n.id} style={{
                  background: C.card, borderLeft: `4px solid ${C.primary}`,
                  borderRadius: "0 12px 12px 0",
                  padding: "11px 13px", marginBottom: 8,
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
                }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: C.primary }}>📢 {n.title}</p>
                    {n.body && <p style={{ margin: "3px 0 0", fontSize: 12, color: C.sub, lineHeight: 1.6 }}>{n.body}</p>}
                  </div>
                  <button onClick={() => setDismissed((prev) => [...prev, n.id])}
                    style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0, marginLeft: 10, padding: 2 }}>
                    <X size={15} color="#9ca3af" strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── クイック追加セクション ── */}
          {!search && (
            <>
              {/* お気に入り */}
              {favoriteProducts.length > 0 && (
                <section style={{ marginTop: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", marginBottom: 2 }}>
                    <Heart size={14} color="#e11d48" fill="#e11d48" strokeWidth={2} />
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>お気に入り</h2>
                    <span style={{ fontSize: 11, color: C.sub }}>{favoriteProducts.length}件</span>
                  </div>
                  {/* ネガティブマージンで全幅スクロール、overflowを内側で閉じる */}
                  <div style={{ overflow: "hidden" }}>
                    <div className="hscroll">
                      {favoriteProducts.map((p) => (
                        <div key={p.id} className="mini-card">
                          <MiniCard product={p} onAdd={addToCart} isFav={true} onFav={toggleFavorite} />
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {/* よく使う商品（頻度順 + 最近注文を統合） */}
              {quickProducts.length > 0 && (
                <section style={{ marginTop: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", marginBottom: 2 }}>
                    <Package size={14} color={C.sub} strokeWidth={2} />
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>よく使う商品</h2>
                    <span style={{ fontSize: 11, color: C.sub }}>{quickProducts.length}件</span>
                  </div>
                  <div style={{ overflow: "hidden" }}>
                    <div className="hscroll">
                      {quickProducts.map((p: any) => (
                        <div key={p.id} className="mini-card">
                          <MiniCard product={p} onAdd={addToCart} isFav={favorites.includes(p.id)} onFav={toggleFavorite} />
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {/* ── 商品一覧 ── */}
          <section style={{ padding: "20px 16px 0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>
                {search ? "検索結果" : category !== "すべて" ? category : "商品一覧"}
              </h2>
              <span style={{ fontSize: 12, color: C.sub }}>{filteredProducts.length}件</span>
            </div>

            {search && filteredProducts.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: C.sub }}>
                <Package size={44} color="#e5e7eb" strokeWidth={1} />
                <p style={{ marginTop: 12, fontSize: 14 }}>「{search}」の商品が見つかりません</p>
                <button onClick={() => setSearch("")} style={{
                  marginTop: 10, padding: "8px 18px", borderRadius: 10,
                  border: "none", background: C.primaryBg, color: C.primary,
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}>
                  検索をクリア
                </button>
              </div>
            )}

            <div className="product-grid">
              {filteredProducts.map((product) => (
                <div key={product.id} className="product-card">
                  {/* 画像エリア */}
                  <div style={{ position: "relative" }}>
                    {product.image_url
                      ? <img src={product.image_url} alt={product.name} loading="lazy"
                          style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
                      : <div style={{
                          height: 80, background: "#f8fafc",
                          display: "flex", flexDirection: "column",
                          alignItems: "center", justifyContent: "center", gap: 4,
                        }}>
                          <Package size={28} color="#cbd5e1" strokeWidth={1.2} />
                          <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.06em" }}>NO IMAGE</span>
                        </div>
                    }
                    <button onClick={() => toggleFavorite(product.id)} style={{
                      position: "absolute", top: 8, right: 8,
                      background: "rgba(255,255,255,0.92)", border: "none",
                      borderRadius: "50%", width: 30, height: 30,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.10)",
                    }}>
                      <Heart size={14}
                        color={favorites.includes(product.id) ? "#e11d48" : "#d1d5db"}
                        fill={favorites.includes(product.id) ? "#e11d48" : "none"}
                        strokeWidth={2} />
                    </button>
                  </div>

                  {/* テキスト情報 */}
                  <div style={{ padding: "11px 13px 13px" }}>
                    <p style={{
                      margin: "0 0 3px", fontWeight: 700, fontSize: 13, color: C.text,
                      lineHeight: 1.45, display: "-webkit-box",
                      WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
                    }}>
                      {product.name}
                    </p>
                    <p style={{ margin: "0 0 9px", fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[product.manufacturer, product.product_code].filter(Boolean).join("　") || "—"}
                    </p>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 10 }}>
                      <span style={{ fontSize: 17, fontWeight: 800, color: C.primary }}>
                        ¥{Number(product.price || 0).toLocaleString()}
                      </span>
                      <span style={{ fontSize: 10, color: "#9ca3af" }}>税抜</span>
                    </div>
                    <button className="add-btn" onClick={() => addToCart(product)} style={{
                      width: "100%", padding: "10px 0", borderRadius: 10,
                      background: C.primary, color: "#fff", border: "none",
                      fontWeight: 700, fontSize: 13, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                      boxShadow: "0 2px 8px rgba(5,150,105,0.25)",
                    }}>
                      <Plus size={14} color="#fff" strokeWidth={2.5} />
                      カートに追加
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>{/* /コンテンツエリア */}
      </div>{/* /メインレイアウト */}

      {/* ── カート下部バー ── */}
      {cart.length > 0 && !showCart && !showConfirm && !showComplete && (
        <div className="cart-bar">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.sub }}>{totalQty}点をカートに追加中</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>
              ¥{totalPrice.toLocaleString()}
              <span style={{ fontSize: 11, fontWeight: 500, color: "#9ca3af", marginLeft: 3 }}>税抜</span>
            </div>
          </div>
          <button onClick={() => setShowCart(true)} style={{
            flexShrink: 0, display: "flex", alignItems: "center", gap: 7,
            padding: "12px 20px", borderRadius: 14,
            background: C.primary, color: "#fff", border: "none",
            fontSize: 14, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 3px 12px rgba(5,150,105,0.38)", whiteSpace: "nowrap",
            transition: "transform 0.1s",
          }}>
            <ShoppingCart size={16} color="#fff" strokeWidth={2} />
            カートを確認
          </button>
        </div>
      )}

      {/* ── TOP ボタン（スクロール後に出現） ── */}
      {showTopBtn && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          style={{
            position: "fixed",
            bottom: cart.length > 0 ? 90 : 28,
            right: 16, zIndex: 40,
            width: 42, height: 42, borderRadius: "50%",
            background: C.primary, border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 3px 12px rgba(5,150,105,0.40)",
            transition: "bottom 0.2s",
          }}
        >
          <ChevronUp size={20} color="#fff" strokeWidth={2.5} />
        </button>
      )}

      {/* ── カートドロワー ── */}
      {showCart && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowCart(false) }}>
          <div style={drawer}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
                <ShoppingCart size={18} color={C.primary} strokeWidth={2} />
                カート
              </h2>
              <button onClick={() => setShowCart(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <X size={22} color="#9ca3af" strokeWidth={2} />
              </button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {cart.map((item) => (
                <CartRow key={item.id} item={item} onMinus={decreaseQty} onPlus={increaseQty} onRemove={removeItem} onSet={setQty} />
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: C.sub, display: "block", marginBottom: 5 }}>備考（任意）</label>
              <textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value)}
                placeholder="急ぎ / ○○先生指定 など"
                rows={2} style={{
                  width: "100%", padding: "9px 12px", borderRadius: 10, border: `1.5px solid ${C.borderMid}`,
                  fontSize: 13, boxSizing: "border-box" as const, outline: "none", color: C.text,
                  resize: "none", lineHeight: 1.6,
                }} />
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
                <span style={{ fontWeight: 700, color: C.sub }}>合計（税抜）</span>
                <span style={{ fontWeight: 800, fontSize: 22, color: C.primary }}>¥{totalPrice.toLocaleString()}</span>
              </div>
              <button onClick={() => { setShowCart(false); setShowConfirm(true) }} style={{
                width: "100%", padding: 15, borderRadius: 14, background: C.accent,
                color: "#fff", border: "none", fontSize: 16, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 3px 12px rgba(234,88,12,0.40)",
              }}>
                注文確認へ →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 注文確認ドロワー ── */}
      {showConfirm && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false) }}>
          <div style={drawer}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text }}>注文確認</h2>
              <button onClick={() => setShowConfirm(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <X size={22} color="#9ca3af" strokeWidth={2} />
              </button>
            </div>
            <p style={{ fontSize: 13, color: C.sub, marginBottom: 12 }}>医院：<strong style={{ color: C.text }}>{clinicName}</strong></p>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: C.sub, display: "block", marginBottom: 5 }}>
                注文者名 <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input value={ordererName} onChange={(e) => setOrdererName(e.target.value)}
                placeholder="例：山田 太郎"
                style={{
                  width: "100%", padding: "10px 13px", borderRadius: 10,
                  border: `1.5px solid ${ordererName.trim() ? C.borderMid : "#fca5a5"}`,
                  fontSize: 14, boxSizing: "border-box" as const, outline: "none", color: C.text,
                }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: C.sub, display: "block", marginBottom: 5 }}>備考（任意）</label>
              <textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value)}
                placeholder="例：急ぎでお願いします　／　○○先生指定　など"
                rows={2} style={{
                  width: "100%", padding: "10px 13px", borderRadius: 10,
                  border: `1.5px solid ${C.borderMid}`, fontSize: 13,
                  boxSizing: "border-box" as const, outline: "none",
                  color: C.text, resize: "none", lineHeight: 1.6,
                }} />
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {cart.map((item) => (
                <div key={item.id} style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: C.text }}>{item.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: C.sub }}>{item.quantity}個 × ¥{Number(item.price || 0).toLocaleString()}</p>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: C.primary }}>
                    ¥{(Number(item.price || 0) * item.quantity).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontWeight: 700, color: C.sub }}>合計（税抜）</span>
                <span style={{ fontWeight: 800, fontSize: 22, color: C.primary }}>¥{totalPrice.toLocaleString()}</span>
              </div>
              <button onClick={submitOrder} style={{
                width: "100%", padding: 15, borderRadius: 14, background: C.confirm,
                color: "#fff", border: "none", fontSize: 16, fontWeight: 700, cursor: "pointer", marginBottom: 8,
                boxShadow: "0 3px 14px rgba(220,38,38,0.40)",
              }}>
                ✓ 注文を確定する
              </button>
              <button onClick={() => { setShowConfirm(false); setShowCart(true) }} style={{
                width: "100%", padding: 12, borderRadius: 12, background: "#fff",
                color: C.sub, border: `1px solid ${C.borderMid}`, fontSize: 14, cursor: "pointer",
              }}>
                ← カートに戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 注文完了オーバーレイ ── */}
      {showComplete && (
        <div style={{ ...overlay, alignItems: "center", justifyContent: "center" }}>
          <div style={{
            background: C.card, borderRadius: 24, padding: "36px 28px",
            maxWidth: 340, width: "calc(100% - 32px)", textAlign: "center",
            boxShadow: "0 8px 40px rgba(0,0,0,0.16)",
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%", background: C.primaryBg,
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <span style={{ fontSize: 36 }}>✅</span>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: C.primary, marginBottom: 6 }}>注文が完了しました</h2>
            <p style={{ fontSize: 13, color: C.sub, marginBottom: 4 }}>{clinicName}</p>
            <p style={{ fontSize: 13, color: C.sub, marginBottom: 28 }}>注文者：{lastOrdererName || "—"}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => setShowComplete(false)} style={{
                width: "100%", padding: 14, borderRadius: 14, background: C.primary,
                color: "#fff", border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 2px 10px rgba(5,150,105,0.35)",
              }}>続けて注文する</button>
              <button onClick={() => router.push(`/order-edit/${lastOrderId}`)} style={{
                width: "100%", padding: 13, borderRadius: 12, background: "#fff",
                color: C.sub, border: `1px solid ${C.borderMid}`, fontSize: 14, cursor: "pointer",
              }}>注文内容を修正</button>
              <button onClick={() => router.push("/menu")} style={{
                width: "100%", padding: 13, borderRadius: 12, background: "#fff",
                color: C.sub, border: `1px solid ${C.borderMid}`, fontSize: 14, cursor: "pointer",
              }}>メニューへ戻る</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ── ミニカード ──────────────────────────────────────────────
function MiniCard({ product, onAdd, isFav, onFav }: any) {
  return (
    <>
      <div style={{ position: "relative" }}>
        {product.image_url
          ? <img src={product.image_url} alt={product.name} loading="lazy"
              style={{ width: "100%", height: 80, objectFit: "cover", display: "block" }} />
          : <div style={{
              height: 68, background: "#f8fafc",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 3,
            }}>
              <Package size={22} color="#cbd5e1" strokeWidth={1.2} />
              <span style={{ fontSize: 8, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em" }}>NO IMAGE</span>
            </div>
        }
        <button onClick={() => onFav(product.id)} style={{
          position: "absolute", top: 5, right: 5,
          background: "rgba(255,255,255,0.90)", border: "none",
          borderRadius: "50%", width: 24, height: 24,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", padding: 0,
        }}>
          <Heart size={12} color={isFav ? "#e11d48" : "#d1d5db"} fill={isFav ? "#e11d48" : "none"} strokeWidth={2} />
        </button>
      </div>
      <div style={{ padding: "8px 10px 10px" }}>
        <p style={{
          margin: "0 0 4px", fontWeight: 700, fontSize: 11, lineHeight: 1.4, color: "#111827",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
        }}>{product.name}</p>
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#059669", fontWeight: 800 }}>
          ¥{Number(product.price || 0).toLocaleString()}
        </p>
        <button onClick={() => onAdd(product)} style={{
          width: "100%", padding: "7px 0", borderRadius: 9, border: "none",
          background: "#059669", color: "#fff", fontSize: 13, fontWeight: 700,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
          <Plus size={13} color="#fff" strokeWidth={2.5} />追加
        </button>
      </div>
    </>
  )
}

// ── カートアイテム行 ────────────────────────────────────────
function CartRow({ item, onMinus, onPlus, onRemove, onSet }: any) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #f9fafb", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827" }}>
          {item.name}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>
          ¥{Number(item.price || 0).toLocaleString()} / 個
        </p>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
        <button onClick={() => onMinus(item.id)} style={qBtn}>
          <Minus size={13} color="#374151" strokeWidth={2} />
        </button>
        <input type="number" min="0" value={item.quantity}
          onChange={(e) => onSet(item.id, e.target.value)}
          style={{ width: 44, height: 36, textAlign: "center", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 15, fontWeight: 700, color: "#111827" }} />
        <button onClick={() => onPlus(item.id)} style={qBtn}>
          <Plus size={13} color="#374151" strokeWidth={2} />
        </button>
        <button onClick={() => onRemove(item.id)} style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #fca5a5", background: "#fff7f7", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Trash2 size={14} color="#ef4444" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

// ── スタイル定数 ────────────────────────────────────────────
const qBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 8,
  border: "1.5px solid #e5e7eb", background: "#f9fafb",
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100,
  display: "flex", alignItems: "flex-end", justifyContent: "center",
}

const drawer: React.CSSProperties = {
  background: "#fff", borderRadius: "22px 22px 0 0", padding: "20px 20px 32px",
  width: "100%", maxWidth: 600, maxHeight: "85vh", display: "flex", flexDirection: "column",
  boxShadow: "0 -4px 24px rgba(0,0,0,0.10)",
}
