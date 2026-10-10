"use client"

// 管理画面のスキャン（スマホ向け）: QRコード／バーコードを読み取って、商品の在庫・棚番・価格をその場で確認し、
// 読み取った商品を数量つきのリストにして、そのまま新規注文へ引き継げる。
// 読み取りのたびに商品をサーバーで検索するので、全商品を読み込まずに、すぐ使い始められる。何もDBには書き込まない。

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode"
import { supabase } from "@/lib/supabase"
import { playBeep } from "@/lib/beep"
import { fmtYen } from "@/lib/invoice"

type Product = {
  id: string; name: string; product_code: string | null; barcode: string | null; manufacturer: string | null
  stock: number | null; location: string | null; price: number | null; cost: number | null; reorder_level: number | null
}
type Row = { product: Product; qty: number }

const COLS = "id,name,product_code,barcode,manufacturer,stock,location,price,cost,reorder_level"
const FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
]

// 読み取った文字から商品を探す（商品に登録したコード → 商品コード（JAN等）の順）
async function findProducts(code: string): Promise<Product[]> {
  const c = code.trim().replace(/[%,()]/g, "")
  if (!c) return []
  const { data } = await supabase.from("products").select(COLS)
    .or(`barcode.eq.${c},product_code.eq.${c}`).limit(5)
  return (data as Product[]) || []
}

export default function AdminScanPage() {
  const router = useRouter()
  const [scanning, setScanning] = useState(false)
  const [camError, setCamError] = useState("")
  const [last, setLast] = useState<Product | null>(null)
  const [notFound, setNotFound] = useState("")
  const [rows, setRows] = useState<Row[]>([])
  const [manual, setManual] = useState("")
  const [results, setResults] = useState<Product[]>([])
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastScan = useRef({ code: "", time: 0 })

  useEffect(() => () => { try { scannerRef.current?.stop() } catch { /* 停止済み */ } }, [])

  function addProduct(p: Product) {
    setLast(p); setNotFound("")
    setRows(prev => prev.some(r => r.product.id === p.id)
      ? prev.map(r => r.product.id === p.id ? { ...r, qty: r.qty + 1 } : r)
      : [{ product: p, qty: 1 }, ...prev])
  }

  async function handleCode(code: string) {
    const now = Date.now()
    if (code === lastScan.current.code && now - lastScan.current.time < 2000) return   // 同じコードの連続読み取りを防ぐ
    lastScan.current = { code, time: now }
    const found = await findProducts(code)
    if (found.length === 0) {
      playBeep("error"); if (navigator.vibrate) navigator.vibrate([80, 50, 80])
      setNotFound(code); setLast(null)
      return
    }
    playBeep("success"); if (navigator.vibrate) navigator.vibrate(60)
    addProduct(found[0])
  }

  async function start() {
    setCamError(""); setScanning(true)
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const scanner = new Html5Qrcode("admin-scan-reader", { formatsToSupport: FORMATS, verbose: false, useBarCodeDetectorIfSupported: true })
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 240, height: 160 } },
        (code) => { void handleCode(code) },
        () => {},
      )
    } catch {
      scannerRef.current = null; setScanning(false)
      setCamError("カメラを起動できませんでした。ブラウザのカメラの許可を確認してください（https のページで、許可が必要です）。")
    }
  }
  async function stop() {
    try { await scannerRef.current?.stop(); scannerRef.current?.clear() } catch { /* 停止済み */ }
    scannerRef.current = null; setScanning(false)
  }

  async function searchManual(e: React.FormEvent) {
    e.preventDefault()
    const q = manual.trim().replace(/[%,()]/g, " ")
    if (!q) return
    const exact = await findProducts(q)
    if (exact.length > 0) { setResults(exact); return }
    const { data } = await supabase.from("products").select(COLS)
      .or(`name.ilike.%${q}%,product_code.ilike.%${q}%`).order("name").limit(20)
    setResults((data as Product[]) || [])
  }

  const setQty = (id: string, d: number) =>
    setRows(prev => prev.map(r => r.product.id === id ? { ...r, qty: Math.max(1, r.qty + d) } : r))
  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.product.id !== id))
  const total = rows.reduce((s, r) => s + r.qty, 0)

  function startOrder() {
    if (rows.length === 0) return
    const items = rows.map(r => `${r.product.id}:${r.qty}`).join(";")
    router.push(`/admin/orders/new?items=${encodeURIComponent(items)}`)
  }

  const big = "flex items-center justify-center rounded-xl font-bold"

  return (
    <div className="space-y-3 max-w-xl mx-auto pb-24">
      <div>
        <h1 className="text-lg font-bold">📷 スキャン</h1>
        <p className="text-xs text-gray-500">QRコード・バーコードを読み取って、在庫や棚番を確認できます。読み取った商品は、数量つきのリストにして、そのまま注文に進めます。</p>
      </div>

      {/* カメラ */}
      <div className="rounded-xl overflow-hidden bg-black">
        <div id="admin-scan-reader" style={{ width: "100%", minHeight: scanning ? 240 : 0 }} />
        {!scanning && (
          <button onClick={start} className={big + " w-full text-white bg-blue-600 text-[16px]"} style={{ minHeight: 64 }}>📷 カメラでスキャンを始める</button>
        )}
        {scanning && (
          <button onClick={stop} className={big + " w-full text-white bg-gray-700 text-[15px]"} style={{ minHeight: 52 }}>■ カメラを止める</button>
        )}
      </div>
      {camError && <p className="text-sm text-red-600">{camError}</p>}

      {/* 読み取り結果 */}
      {notFound && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          ⚠ 「{notFound}」に一致する商品が見つかりません。
          <div className="text-xs text-red-500 mt-1">QRコード管理で、その商品のQRコードを作り直すか、下の検索で探してください。</div>
        </div>
      )}
      {last && (
        <div className="rounded-xl border-2 border-emerald-400 bg-white p-3 shadow-sm">
          <div className="text-[11px] text-emerald-700 font-bold">✅ 読み取った商品</div>
          <div className="font-bold text-[16px] leading-snug">{last.name}</div>
          <div className="text-[12px] text-gray-500 font-mono">{last.product_code || ""}　{last.manufacturer || ""}</div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-center">
            <div className="rounded-lg bg-gray-50 py-2">
              <div className="text-[11px] text-gray-500">在庫</div>
              <div className={"text-2xl font-bold " + (Number(last.stock || 0) <= 0 ? "text-red-600" : "text-gray-900")}>{Number(last.stock || 0)}</div>
            </div>
            <div className="rounded-lg bg-gray-50 py-2">
              <div className="text-[11px] text-gray-500">棚番</div>
              <div className="text-lg font-bold">{last.location || "—"}</div>
            </div>
            <div className="rounded-lg bg-gray-50 py-2">
              <div className="text-[11px] text-gray-500">定価</div>
              <div className="text-lg font-bold">{last.price != null ? fmtYen(last.price) : "—"}</div>
            </div>
          </div>
          {last.reorder_level != null && Number(last.stock || 0) <= Number(last.reorder_level) && (
            <div className="mt-2 text-[12px] text-amber-700 font-bold">⚠ 在庫が発注点（{last.reorder_level}）以下です</div>
          )}
        </div>
      )}

      {/* 手入力・検索 */}
      <form onSubmit={searchManual} className="flex gap-2">
        <input value={manual} onChange={e => setManual(e.target.value)} placeholder="商品名・コードで探す（読み取れないとき）" className="flex-1 px-3 border border-gray-300 rounded-lg bg-white" />
        <button type="submit" className="px-4 rounded-lg bg-slate-700 text-white font-bold" style={{ minHeight: 44 }}>検索</button>
      </form>
      {results.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white divide-y">
          {results.map(p => (
            <button key={p.id} onClick={() => { addProduct(p); setResults([]); setManual("") }} className="w-full text-left px-3 py-2">
              <div className="text-[14px] font-bold">{p.name}</div>
              <div className="text-[11px] text-gray-500">{p.product_code || ""}　在庫 {Number(p.stock || 0)}</div>
            </button>
          ))}
        </div>
      )}

      {/* 読み取りリスト */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold text-[14px]">読み取りリスト（{rows.length}種類・{total}個）</h2>
          {rows.length > 0 && <button onClick={() => { setRows([]); setLast(null) }} className="text-xs text-gray-500 underline">全部消す</button>}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">まだ読み取っていません</p>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.product.id} className="rounded-xl border border-gray-200 bg-white p-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold truncate">{r.product.name}</div>
                  <div className="text-[11px] text-gray-500">在庫 {Number(r.product.stock || 0)}　{r.product.location || ""}</div>
                </div>
                <button onClick={() => setQty(r.product.id, -1)} className="rounded-lg border border-gray-300 text-lg font-bold" style={{ width: 44, height: 44 }}>−</button>
                <span className="w-8 text-center font-bold text-[16px]">{r.qty}</span>
                <button onClick={() => setQty(r.product.id, 1)} className="rounded-lg border border-gray-300 text-lg font-bold" style={{ width: 44, height: 44 }}>＋</button>
                <button onClick={() => removeRow(r.product.id)} className="text-gray-400 px-1" title="リストから外す">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 画面下の操作 */}
      {rows.length > 0 && (
        <div className="fixed left-0 right-0 bottom-16 md:bottom-0 px-3 pb-2 pt-2 bg-white/95 border-t border-gray-200 z-30">
          <button onClick={startOrder} className={big + " w-full bg-emerald-600 text-white text-[16px]"} style={{ minHeight: 52 }}>
            🛒 注文を作る（{rows.length}種類）
          </button>
        </div>
      )}
      <div className="text-center"><Link href="/admin/barcodes" className="text-xs text-blue-700 underline">QRコード管理（ラベルを印刷する）</Link></div>
    </div>
  )
}
