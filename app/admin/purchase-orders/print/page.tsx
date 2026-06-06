"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"

type PO = { id: string; po_number: string | null; supplier_id: string | null; ordered_at: string | null; expected_at: string | null; total_amount: number | null; note: string | null; sent_method: string | null; status: string }
type Item = { id: string; purchase_order_id: string; product_id: string | null; product_name: string | null; quantity: number; unit_price: number; note: string | null }
type Supplier = { id: string; name: string; address: string | null; phone: string | null; fax: string | null; contact: string | null }

export default function BulkPrintWrapper() {
  return (
    <Suspense fallback={<p>読み込み中…</p>}>
      <BulkPrint />
    </Suspense>
  )
}

function BulkPrint() {
  const sp = useSearchParams()
  const ids = (sp.get("ids") || "").split(",").filter(Boolean)
  const [pos, setPos] = useState<PO[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  useEffect(() => {
    if (ids.length === 0) return
    let cancelled = false
    let printTimer: ReturnType<typeof setTimeout> | null = null
    Promise.all([
      supabase.from("purchase_orders").select("*").in("id", ids),
      supabase.from("purchase_order_items").select("*").in("purchase_order_id", ids),
      supabase.from("suppliers").select("*").limit(50000),
    ]).then(([p, i, s]) => {
      if (cancelled) return
      setPos((p.data as PO[]) || [])
      setItems((i.data as Item[]) || [])
      setSuppliers((s.data as Supplier[]) || [])
      printTimer = setTimeout(() => { if (!cancelled) window.print() }, 800)
    })
    return () => {
      cancelled = true
      if (printTimer) clearTimeout(printTimer)
    }
  }, [ids.join(",")])

  const supBy = new Map(suppliers.map(s => [s.id, s]))
  const itemsByPO = new Map<string, Item[]>()
  items.forEach(i => { if (!itemsByPO.has(i.purchase_order_id)) itemsByPO.set(i.purchase_order_id, []); itemsByPO.get(i.purchase_order_id)!.push(i) })

  return (
    <>
      <div className="no-print p-4 bg-yellow-50 border-b border-yellow-200 sticky top-0">
        <button onClick={() => window.print()} className="px-4 py-2 bg-gray-900 text-white text-sm rounded mr-2">🖨 印刷</button>
        <button onClick={() => window.close()} className="px-4 py-2 bg-gray-200 text-sm rounded">閉じる</button>
        <span className="ml-3 text-xs text-gray-700">{pos.length}件の発注書</span>
      </div>
      {pos.map(po => {
        const sup = po.supplier_id ? supBy.get(po.supplier_id) : null
        const its = itemsByPO.get(po.id) || []
        return (
          <main key={po.id} className="bg-white max-w-3xl mx-auto p-8 mb-8 print-page" style={{ pageBreakAfter: "always", minHeight: "27cm" }}>
            <header style={{ borderBottom: "2px solid #111", paddingBottom: 8 }}>
              <h1 style={{ fontSize: 28, letterSpacing: "0.3em", margin: "20px 0 4px", textAlign: "center" }}>発 注 書</h1>
              <p style={{ textAlign: "center", margin: 0, fontSize: 11, color: "#666" }}>No. {po.po_number || po.id.slice(0, 8)}</p>
            </header>
            <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 6 }}>
                  {sup?.name || "(仕入先未設定)"} 御中
                </p>
                {sup?.address && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#666" }}>{sup.address}</p>}
                {sup?.phone && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>TEL {sup.phone}{sup.fax && ` / FAX ${sup.fax}`}</p>}
              </div>
              <div style={{ flexShrink: 0, fontSize: 11, lineHeight: 1.6, position: "relative", paddingRight: 70 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{COMPANY.name}</p>
                <p style={{ margin: 0 }}>〒{COMPANY.postalCode}</p>
                <p style={{ margin: 0 }}>{COMPANY.address}</p>
                <p style={{ margin: 0 }}>TEL {COMPANY.phone}</p>
                {COMPANY.fax && <p style={{ margin: 0 }}>FAX {COMPANY.fax}</p>}
                <div style={{ position: "absolute", top: 0, right: 0 }}><Seal size={64} /></div>
              </div>
            </div>
            <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                <tr>
                  <td style={tdL}>発注日</td><td style={tdR}>{po.ordered_at ? new Date(po.ordered_at).toLocaleDateString("ja-JP") : "—"}</td>
                  <td style={tdL}>納期希望</td><td style={tdR}>{po.expected_at ? new Date(po.expected_at).toLocaleDateString("ja-JP") : "—"}</td>
                </tr>
              </tbody>
            </table>
            <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={th}>商品名</th>
                  <th style={{ ...th, textAlign: "right", width: 80 }}>数量</th>
                </tr>
              </thead>
              <tbody>
                {its.map(i => (
                  <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={tdC}>{i.product_name}{i.note && <p style={{ margin: "2px 0 0", fontSize: 9, color: "#999" }}>{i.note}</p>}</td>
                    <td style={{ ...tdC, textAlign: "right" }}>{i.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: 12, fontSize: 10, color: "#666" }}>※ 単価・金額は貴社見積書にてご確認ください。</p>
            {po.note && <div style={{ marginTop: 16, padding: 10, background: "#f9fafb", borderRadius: 4, fontSize: 11, color: "#555" }}>備考: {po.note}</div>}
          </main>
        )
      })}
      <style jsx global>{`
        /* ── admin-base.css の table/h1 強制スタイルを発注書印刷ページ内で上書き ── */
        .print-page.print-page table td,
        .print-page.print-page table th {
          padding: 4px 8px !important;
          font-size: 11px !important;
        }
        .print-page.print-page table td div,
        .print-page.print-page table td span,
        .print-page.print-page table td p {
          font-size: 11px !important;
        }
        .print-page.print-page h1 {
          font-size: 28px !important;
        }
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 10mm; }
          /* 発注書ごとに改ページ */
          .print-page { break-after: page !important; }
          /* テーブル行が途中で切れないようにする */
          .print-page table { break-inside: auto; }
          .print-page table thead { display: table-header-group; }
          .print-page table tr { break-inside: avoid; break-after: auto; }
          /* ヘッダーブロックを明細と分離させない */
          .print-page header { break-inside: avoid; break-after: avoid; }
        }
      `}</style>
    </>
  )
}

const th: React.CSSProperties = { padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #ddd", fontSize: 11, color: "#555" }
const tdL: React.CSSProperties = { padding: "4px 8px", background: "#f9fafb", fontSize: 11, color: "#555", width: 80, borderRight: "1px solid #eee" }
const tdR: React.CSSProperties = { padding: "4px 8px", fontSize: 11, color: "#111", borderRight: "1px solid #eee" }
const tdC: React.CSSProperties = { padding: "6px 8px", fontSize: 12 }
