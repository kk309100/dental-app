"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { QRCodeSVG } from "qrcode.react"
import dynamic from "next/dynamic"

// react-barcode はブラウザ専用 → SSR無効で動的インポート
const Barcode = dynamic(() => import("react-barcode"), { ssr: false })

const C = {
  primary: "#22a648",
  blue:    "#2563eb",
  border:  "#e5e7eb",
  bg:      "#f8f9fa",
  text:    "#111827",
  sub:     "#6b7280",
}

type Item = {
  id: string
  product_name: string
  maker: string | null
  barcode: string | null
  location: string | null
  shelf_no: string | null
}

type CodeType = "qr" | "barcode"
type LabelSize = "s" | "m" | "l"

const SIZES: Record<LabelSize, { label: string; mm: string; qr: number; cols: number }> = {
  s: { label: "小",  mm: "50×35mm",  qr: 64,  cols: 4 },
  m: { label: "中",  mm: "70×50mm",  qr: 90,  cols: 3 },
  l: { label: "大",  mm: "90×65mm",  qr: 120, cols: 2 },
}

export default function LabelsPage() {
  const router = useRouter()
  const [items, setItems]       = useState<Item[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [codeType, setCodeType] = useState<CodeType>("qr")
  const [size, setSize]         = useState<LabelSize>("m")
  const [search, setSearch]     = useState("")

  useEffect(() => { init() }, [])

  async function init() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }

    const { data } = await supabase.from("clinic_inventory_items")
      .select("id,product_name,maker,barcode,location,shelf_no")
      .order("product_name")
    setItems((data as Item[]) || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const k = search.toLowerCase()
    return items.filter(i =>
      !k ||
      i.product_name.toLowerCase().includes(k) ||
      (i.location || "").toLowerCase().includes(k) ||
      (i.barcode || "").toLowerCase().includes(k)
    )
  }, [items, search])

  function toggleAll() {
    if (filtered.every(i => selected.has(i.id))) {
      const next = new Set(selected)
      filtered.forEach(i => next.delete(i.id))
      setSelected(next)
    } else {
      const next = new Set(selected)
      filtered.forEach(i => next.add(i.id))
      setSelected(next)
    }
  }

  function toggle(id: string) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  const printItems = items.filter(i => selected.has(i.id))
  const allChecked = filtered.length > 0 && filtered.every(i => selected.has(i.id))
  const sz = SIZES[size]

  // バーコードに使う値（数字のみでなければQRにフォールバック）
  function codeValue(item: Item) {
    return item.barcode?.trim() || item.product_name
  }

  function isNumericBarcode(item: Item) {
    const v = item.barcode?.trim() || ""
    return /^[0-9]{6,20}$/.test(v)
  }

  return (
    <>
      {/* 印刷スタイル */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-area { display: block !important; }
          body { margin: 0; background: white; }
          @page { margin: 8mm; size: A4; }
        }
        @media screen {
          .print-area { display: none; }
        }
        .label-grid {
          display: grid;
          grid-template-columns: repeat(${sz.cols}, 1fr);
          gap: 4mm;
        }
        .label-card {
          border: 1px dashed #aaa;
          border-radius: 3mm;
          padding: 3mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          page-break-inside: avoid;
          break-inside: avoid;
          box-sizing: border-box;
        }
        .label-name {
          font-weight: bold;
          font-size: ${size === "s" ? "7pt" : size === "m" ? "9pt" : "11pt"};
          line-height: 1.3;
          margin-bottom: 2mm;
          word-break: break-all;
          max-width: 100%;
        }
        .label-sub {
          font-size: ${size === "s" ? "6pt" : "7pt"};
          color: #666;
          margin-top: 1.5mm;
        }
        .label-bc {
          font-size: 6pt;
          color: #888;
          margin-top: 0.5mm;
        }
      `}</style>

      {/* ── 設定UI（画面表示のみ） ── */}
      <main className="no-print" style={{ maxWidth: 700, margin: "0 auto", padding: "16px 12px", background: C.bg, minHeight: "100vh" }}>
        {/* ヘッダー */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={() => router.push("/inventory")} style={{
            background: "#e8f5ec", color: C.primary, border: "1px solid #b2dfbd",
            borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: "bold", cursor: "pointer",
          }}>← 在庫記録</button>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: "bold", color: C.text }}>🏷 ラベル印刷</h1>
        </div>

        {/* コードタイプ選択 */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 12, border: `1px solid ${C.border}` }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: "bold", color: C.text }}>コード種類</p>
          <div style={{ display: "flex", gap: 8 }}>
            {([["qr", "QRコード（推奨）"], ["barcode", "バーコード"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setCodeType(v)} style={{
                flex: 1, padding: "9px 0", borderRadius: 9, fontWeight: "bold", fontSize: 14,
                border: `2px solid ${codeType === v ? C.primary : C.border}`,
                background: codeType === v ? "#e8f5ec" : "#f9fafb",
                color: codeType === v ? C.primary : C.sub, cursor: "pointer",
              }}>{label}</button>
            ))}
          </div>
          {codeType === "barcode" && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#f59e0b" }}>
              ⚠ バーコードは数字のみ対応。数字以外のバーコード・未登録商品は自動でQRに切り替わります。
            </p>
          )}
        </div>

        {/* サイズ選択 */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 12, border: `1px solid ${C.border}` }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: "bold", color: C.text }}>ラベルサイズ</p>
          <div style={{ display: "flex", gap: 8 }}>
            {(Object.entries(SIZES) as [LabelSize, typeof SIZES[LabelSize]][]).map(([k, v]) => (
              <button key={k} onClick={() => setSize(k)} style={{
                flex: 1, padding: "9px 0", borderRadius: 9, fontWeight: "bold", fontSize: 14,
                border: `2px solid ${size === k ? C.blue : C.border}`,
                background: size === k ? "#eff6ff" : "#f9fafb",
                color: size === k ? C.blue : C.sub, cursor: "pointer",
              }}>
                {v.label}<br />
                <span style={{ fontSize: 11, fontWeight: "normal" }}>{v.mm}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 商品選択 */}
        <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: "bold", color: C.text, flex: 1 }}>
              印刷する商品を選択
              {selected.size > 0 && <span style={{ color: C.primary, marginLeft: 8 }}>{selected.size}件選択中</span>}
            </p>
            <button onClick={toggleAll} style={{
              padding: "5px 12px", borderRadius: 7, border: `1px solid ${C.border}`,
              background: "#f9fafb", color: C.sub, fontSize: 12, cursor: "pointer", fontWeight: "bold",
            }}>{allChecked ? "全解除" : "全選択"}</button>
          </div>
          <div style={{ padding: "10px 14px" }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 商品名・場所で絞り込み"
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 14, boxSizing: "border-box", outline: "none", marginBottom: 10 }} />
          </div>
          {loading ? (
            <p style={{ textAlign: "center", color: C.sub, padding: "24px 0" }}>読み込み中…</p>
          ) : (
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {filtered.map(item => (
                <label key={item.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
                  borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                  background: selected.has(item.id) ? "#f0fdf4" : "#fff",
                }}>
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)}
                    style={{ width: 18, height: 18, accentColor: C.primary, cursor: "pointer", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "bold", fontSize: 14, color: C.text }}>{item.product_name}</div>
                    <div style={{ fontSize: 12, color: C.sub }}>
                      {[item.location, item.shelf_no ? `棚 ${item.shelf_no}` : null, item.barcode ? `# ${item.barcode}` : null].filter(Boolean).join("　")}
                    </div>
                  </div>
                  {/* プレビュー */}
                  <div style={{ flexShrink: 0 }}>
                    <QRCodeSVG value={codeValue(item)} size={32} />
                  </div>
                </label>
              ))}
              {filtered.length === 0 && (
                <p style={{ textAlign: "center", color: C.sub, padding: "24px 0", fontSize: 14 }}>商品が見つかりません</p>
              )}
            </div>
          )}
        </div>

        {/* 印刷ボタン */}
        <button
          onClick={() => window.print()}
          disabled={selected.size === 0}
          style={{
            width: "100%", padding: 16, borderRadius: 12, border: "none",
            background: selected.size === 0 ? "#d1d5db" : C.primary,
            color: "#fff", fontWeight: "bold", fontSize: 16,
            cursor: selected.size === 0 ? "default" : "pointer",
          }}>
          🖨 {selected.size === 0 ? "商品を選択してください" : `${selected.size}件のラベルを印刷する`}
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: C.sub, marginTop: 8 }}>
          印刷ダイアログで「用紙サイズ：A4」「余白：なし（または最小）」を選択してください
        </p>
      </main>

      {/* ── 印刷エリア（印刷時のみ表示） ── */}
      <div className="print-area">
        <div className="label-grid">
          {printItems.map(item => {
            const val = codeValue(item)
            const useBarcode = codeType === "barcode" && isNumericBarcode(item)
            return (
              <div key={item.id} className="label-card">
                <div className="label-name">{item.product_name}</div>
                {useBarcode ? (
                  <Barcode
                    value={val}
                    width={size === "s" ? 0.8 : size === "m" ? 1.1 : 1.4}
                    height={size === "s" ? 30 : size === "m" ? 40 : 55}
                    fontSize={7}
                    displayValue={true}
                    margin={0}
                  />
                ) : (
                  <QRCodeSVG value={val} size={sz.qr} />
                )}
                {item.location && <div className="label-sub">📍 {item.location}{item.shelf_no ? ` / ${item.shelf_no}` : ""}</div>}
                {item.barcode && !useBarcode && <div className="label-bc">{item.barcode}</div>}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
