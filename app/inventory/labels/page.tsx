"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { QRCodeSVG } from "qrcode.react"
import dynamic from "next/dynamic"

const Barcode = dynamic(() => import("react-barcode"), { ssr: false })

const C = {
  primary: "#22a648",
  blue:    "#2563eb",
  purple:  "#7c3aed",
  border:  "#e5e7eb",
  bg:      "#f3f4f6",
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
  supplier: string | null
}

type CodeType = "qr" | "barcode"
type LabelSize = "s" | "m" | "l"

const SIZES: Record<LabelSize, { label: string; desc: string; qr: number; cols: number; fontPt: number; subPt: number }> = {
  s: { label: "小",  desc: "50×35mm・4列", qr: 60,  cols: 4, fontPt: 7,  subPt: 6  },
  m: { label: "中",  desc: "70×50mm・3列", qr: 88,  cols: 3, fontPt: 9,  subPt: 7  },
  l: { label: "大",  desc: "90×65mm・2列", qr: 116, cols: 2, fontPt: 11, subPt: 8  },
}

function codeValue(item: Item) {
  return item.barcode?.trim() || item.product_name
}

function isNumericBarcode(item: Item) {
  return /^[0-9]{6,20}$/.test(item.barcode?.trim() || "")
}

export default function LabelsPage() {
  const router = useRouter()
  const [items, setItems]       = useState<Item[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [codeType, setCodeType] = useState<CodeType>("qr")
  const [size, setSize]         = useState<LabelSize>("m")
  const [search, setSearch]     = useState("")
  const [showSettings, setShowSettings] = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }
    const { data } = await supabase.from("clinic_inventory_items")
      .select("id,product_name,maker,barcode,location,shelf_no,supplier")
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
      const next = new Set(selected); filtered.forEach(i => next.delete(i.id)); setSelected(next)
    } else {
      const next = new Set(selected); filtered.forEach(i => next.add(i.id)); setSelected(next)
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

  return (
    <>
      <style>{`
        /* ── 画面表示 ── */
        .settings-panel { display: block; }
        .label-preview-wrap {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 12px;
          margin: 0 0 80px;
        }
        .print-btn-bar {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: white; border-top: 1px solid #e5e7eb;
          padding: 12px 16px; z-index: 50;
        }

        /* ── 印刷時 ── */
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          @page { margin: 8mm; size: A4 portrait; }
          .settings-panel { display: none !important; }
          .print-btn-bar  { display: none !important; }
          .label-preview-wrap {
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .back-btn { display: none !important; }
        }

        /* ── ラベルグリッド ── */
        .label-grid {
          display: grid;
          grid-template-columns: repeat(${sz.cols}, 1fr);
          gap: 3mm;
        }
        .label-card {
          border: 1px dashed #999;
          border-radius: 2mm;
          padding: 2.5mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          page-break-inside: avoid;
          break-inside: avoid;
          box-sizing: border-box;
          min-height: ${size === "s" ? "35mm" : size === "m" ? "50mm" : "65mm"};
        }
        .label-name {
          font-weight: bold;
          font-size: ${sz.fontPt}pt;
          line-height: 1.3;
          margin-bottom: 1.5mm;
          word-break: break-all;
          max-width: 100%;
          color: #111;
        }
        .label-sub {
          font-size: ${sz.subPt}pt;
          color: #555;
          margin-top: 1.5mm;
          line-height: 1.4;
        }
        .label-bc-text {
          font-size: 5.5pt;
          color: #888;
          margin-top: 0.5mm;
        }
      `}</style>

      {/* ── ヘッダー ── */}
      <div className="settings-panel" style={{
        background: "#fff", borderBottom: `1px solid ${C.border}`,
        padding: "10px 14px", position: "sticky", top: 0, zIndex: 30,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <button className="back-btn" onClick={() => router.push("/inventory")} style={{
          background: "#e8f5ec", color: C.primary, border: "1px solid #b2dfbd",
          borderRadius: 7, padding: "6px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer",
        }}>← 在庫</button>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: "bold", color: C.text, flex: 1 }}>
          🏷 ラベル印刷
        </h1>
        <button onClick={() => setShowSettings(v => !v)} style={{
          background: "#f3f4f6", color: C.sub, border: `1px solid ${C.border}`,
          borderRadius: 7, padding: "6px 12px", fontSize: 13, cursor: "pointer",
        }}>{showSettings ? "設定を隠す ▲" : "設定を表示 ▼"}</button>
      </div>

      <div style={{ background: C.bg, minHeight: "100vh", padding: "12px 12px 0" }}>

        {/* ── 設定パネル ── */}
        {showSettings && (
          <div className="settings-panel">
            {/* コード種類 */}
            <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 10, border: `1px solid ${C.border}` }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: "bold", color: C.text }}>コード種類</p>
              <div style={{ display: "flex", gap: 8 }}>
                {([["qr", "QRコード（推奨）"], ["barcode", "バーコード"]] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setCodeType(v)} style={{
                    flex: 1, padding: "10px 0", borderRadius: 9, fontWeight: "bold", fontSize: 14,
                    border: `2px solid ${codeType === v ? C.primary : C.border}`,
                    background: codeType === v ? "#e8f5ec" : "#f9fafb",
                    color: codeType === v ? C.primary : C.sub, cursor: "pointer",
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* サイズ */}
            <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 10, border: `1px solid ${C.border}` }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: "bold", color: C.text }}>ラベルサイズ</p>
              <div style={{ display: "flex", gap: 8 }}>
                {(Object.entries(SIZES) as [LabelSize, typeof SIZES[LabelSize]][]).map(([k, v]) => (
                  <button key={k} onClick={() => setSize(k)} style={{
                    flex: 1, padding: "10px 0", borderRadius: 9, fontWeight: "bold", fontSize: 14,
                    border: `2px solid ${size === k ? C.blue : C.border}`,
                    background: size === k ? "#eff6ff" : "#f9fafb",
                    color: size === k ? C.blue : C.sub, cursor: "pointer",
                  }}>
                    {v.label}<br />
                    <span style={{ fontSize: 10, fontWeight: "normal" }}>{v.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 商品選択 */}
            <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: "bold", color: C.text, flex: 1 }}>
                  商品選択
                  {selected.size > 0 && <span style={{ color: C.primary, marginLeft: 8 }}>{selected.size}件</span>}
                </p>
                <button onClick={toggleAll} style={{
                  padding: "5px 12px", borderRadius: 7, border: `1px solid ${C.border}`,
                  background: "#f9fafb", color: C.sub, fontSize: 12, cursor: "pointer", fontWeight: "bold",
                }}>{allChecked ? "全解除" : "全選択"}</button>
              </div>
              <div style={{ padding: "8px 12px" }}>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 商品名・場所で絞り込み"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 14, boxSizing: "border-box", outline: "none" }} />
              </div>
              {loading ? (
                <p style={{ textAlign: "center", color: C.sub, padding: "20px 0" }}>読み込み中…</p>
              ) : (
                <div style={{ maxHeight: 260, overflowY: "auto" }}>
                  {filtered.map(item => (
                    <label key={item.id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                      borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                      background: selected.has(item.id) ? "#f0fdf4" : "#fff",
                    }}>
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)}
                        style={{ width: 20, height: 20, accentColor: C.primary, cursor: "pointer", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: "bold", fontSize: 14, color: C.text }}>{item.product_name}</div>
                        <div style={{ fontSize: 12, color: C.sub }}>
                          {[item.location, item.shelf_no ? `棚 ${item.shelf_no}` : null, item.barcode ? `# ${item.barcode}` : null].filter(Boolean).join("  ")}
                        </div>
                      </div>
                      <QRCodeSVG value={codeValue(item)} size={28} />
                    </label>
                  ))}
                  {filtered.length === 0 && (
                    <p style={{ textAlign: "center", color: C.sub, padding: "20px 0" }}>商品がありません</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ラベルプレビュー（画面 & 印刷共通） ── */}
        {printItems.length > 0 ? (
          <div className="label-preview-wrap">
            <p className="settings-panel" style={{ margin: "0 0 8px", fontSize: 12, color: C.sub }}>
              印刷プレビュー（{printItems.length}件）
            </p>
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
                        width={size === "s" ? 0.8 : size === "m" ? 1.0 : 1.3}
                        height={size === "s" ? 28 : size === "m" ? 38 : 52}
                        fontSize={6}
                        displayValue={true}
                        margin={0}
                      />
                    ) : (
                      <QRCodeSVG value={val} size={sz.qr} />
                    )}
                    {(item.location || item.shelf_no || item.supplier) && (
                      <div className="label-sub">
                        {item.location && <div>📍 {item.location}{item.shelf_no ? ` / ${item.shelf_no}` : ""}</div>}
                        {item.supplier && <div>🛒 {item.supplier}</div>}
                      </div>
                    )}
                    {item.barcode && !useBarcode && (
                      <div className="label-bc-text">{item.barcode}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="settings-panel label-preview-wrap" style={{ textAlign: "center", color: C.sub, padding: "40px 0", fontSize: 14 }}>
            上のリストから商品を選択するとここにプレビューが表示されます
          </div>
        )}
      </div>

      {/* ── 印刷ボタン（固定フッター） ── */}
      <div className="print-btn-bar">
        <button
          onClick={() => window.print()}
          disabled={printItems.length === 0}
          style={{
            width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
            background: printItems.length === 0 ? "#d1d5db" : C.purple,
            color: "#fff", fontWeight: "bold", fontSize: 16,
            cursor: printItems.length === 0 ? "default" : "pointer",
          }}>
          🖨 {printItems.length === 0 ? "商品を選択してください" : `${printItems.length}件を印刷する`}
        </button>
        <p style={{ textAlign: "center", fontSize: 11, color: C.sub, margin: "6px 0 0" }}>
          iPadの場合：印刷 → AirPrint対応プリンターを選択
        </p>
      </div>
    </>
  )
}
