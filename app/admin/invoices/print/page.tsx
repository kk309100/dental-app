"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen, fmtDate, getClinicPrefix, getCorporateLabel } from "@/lib/invoice"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"

type Invoice = { id: string; clinic_id: string | null; invoice_number: string; issue_date: string; due_date: string | null; subtotal: number; tax: number; total: number; status: string; notes: string | null }
type Order = { id: string; clinic_id: string; invoice_id: string | null }
type Item = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number }
type Clinic = { id: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null; payment_method?: string | null }
type Product = { id: string; name: string }

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
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    if (ids.length === 0) return
    let cancelled = false
    let printTimer: ReturnType<typeof setTimeout> | null = null
    ;(async () => {
      const { data: invs } = await supabase.from("invoices").select("*").in("id", ids)
      if (cancelled) return
      setInvoices((invs as Invoice[]) || [])
      const { data: ords } = await supabase.from("orders").select("id,clinic_id,invoice_id").in("invoice_id", ids)
      if (cancelled) return
      setOrders((ords as Order[]) || [])
      const orderIds = (ords || []).map(o => o.id)
      if (orderIds.length > 0) {
        const { data: its } = await supabase.from("order_items").select("*").in("order_id", orderIds)
        if (cancelled) return
        setItems((its as Item[]) || [])
        const pids = Array.from(new Set((its || []).map(i => i.product_id).filter(Boolean) as string[]))
        if (pids.length > 0) {
          const { data: prods } = await supabase.from("products").select("id,name").in("id", pids)
          if (cancelled) return
          setProducts((prods as Product[]) || [])
        }
      }
      const { data: cls } = await supabase.from("clinics").select("*").limit(50000)
      if (cancelled) return
      setClinics((cls as Clinic[]) || [])
      printTimer = setTimeout(() => { if (!cancelled) window.print() }, 1000)
    })()
    return () => {
      cancelled = true
      if (printTimer) clearTimeout(printTimer)
    }
  }, [ids.join(",")])

  const clinicBy = new Map(clinics.map(c => [c.id, c]))
  const productBy = new Map(products.map(p => [p.id, p.name]))

  return (
    <>
      <div className="no-print p-4 bg-yellow-50 border-b border-yellow-200 sticky top-0">
        <button onClick={() => window.print()} className="px-4 py-2 bg-gray-900 text-white text-sm rounded mr-2">🖨 印刷</button>
        <button onClick={() => window.close()} className="px-4 py-2 bg-gray-200 text-sm rounded">閉じる</button>
        <span className="ml-3 text-xs text-gray-700">{invoices.length}件の請求書</span>
      </div>
      {invoices.map(inv => {
        const cl = inv.clinic_id ? clinicBy.get(inv.clinic_id) : null
        const invOrders = orders.filter(o => o.invoice_id === inv.id)
        const invItems = items.filter(it => invOrders.some(o => o.id === it.order_id))
        // 商品名で集約
        const map = new Map<string, { name: string; qty: number; amount: number }>()
        invItems.forEach(it => {
          const name = it.product_name || (it.product_id && productBy.get(it.product_id)) || "(商品名なし)"
          const e = map.get(name) || { name, qty: 0, amount: 0 }
          e.qty += it.quantity || 0
          e.amount += (it.price || 0) * (it.quantity || 0)
          map.set(name, e)
        })
        const summary = Array.from(map.values()).sort((a, b) => b.amount - a.amount)
        const corporateLabel = cl ? getCorporateLabel(cl.corporate_name, cl.name, cl.clinic_type) : ""
        const prefix = cl ? getClinicPrefix(cl.name, cl.corporate_name, cl.clinic_type) : ""
        const isLast = inv.id === invoices[invoices.length - 1]?.id
        return (
          <main key={inv.id} className={`bg-white max-w-3xl mx-auto p-8 mb-8 print-page${isLast ? " print-page-last" : ""}`} style={{ minHeight: "27cm" }}>
            <header style={{ borderBottom: "2px solid #111", paddingBottom: 8 }}>
              <h1 style={{ fontSize: 28, letterSpacing: "0.3em", margin: "20px 0 4px", textAlign: "center" }}>請　求　書</h1>
              <p style={{ textAlign: "center", margin: 0, fontSize: 11, color: "#666" }}>No. {inv.invoice_number}</p>
            </header>
            <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
              <div style={{ flex: 1 }}>
                {corporateLabel && <p style={{ margin: "0 0 4px", fontSize: 13, color: "#444" }}>{corporateLabel}</p>}
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 6 }}>
                  {prefix}{cl?.name || "(医院不明)"}　御中
                </p>
                {cl?.adress && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#666" }}>{cl.adress}</p>}
              </div>
              <div style={{ flexShrink: 0, fontSize: 11, lineHeight: 1.6, position: "relative", paddingRight: 70 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{COMPANY.name}</p>
                <p style={{ margin: 0 }}>〒{COMPANY.postalCode}</p>
                <p style={{ margin: 0 }}>{COMPANY.address}</p>
                <p style={{ margin: 0 }}>TEL {COMPANY.phone}{COMPANY.fax && ` / FAX ${COMPANY.fax}`}</p>
                <p style={{ margin: "4px 0 0", fontSize: 10, color: "#666" }}>登録番号: {COMPANY.invoiceNumber}</p>
                <div style={{ position: "absolute", top: 0, right: 0 }}><Seal size={64} /></div>
              </div>
            </div>
            <p style={{ margin: "16px 0 6px", fontSize: 12, color: "#333" }}>
              {(() => {
                const issueDate = new Date(inv.issue_date)
                const issueFmt = `${issueDate.getFullYear()}年${issueDate.getMonth() + 1}月${issueDate.getDate()}日`
                let dueFmt: string
                if (inv.due_date) {
                  const d = new Date(inv.due_date)
                  dueFmt = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
                } else {
                  const endOfNextMonth = new Date(issueDate.getFullYear(), issueDate.getMonth() + 2, 0)
                  dueFmt = `${endOfNextMonth.getFullYear()}年${endOfNextMonth.getMonth() + 1}月${endOfNextMonth.getDate()}日`
                }
                return (
                  <>締切日（請求日）: <strong>{issueFmt}</strong>　お支払期限: <strong>{dueFmt}</strong>（締切日より1ヶ月後）</>
                )
              })()}
            </p>
            {cl?.payment_method === "カード" && (
              <div style={{ margin: "10px 0" }}>
                <div style={{
                  display: "inline-block",
                  padding: "8px 24px",
                  border: "3px solid #dc2626",
                  color: "#dc2626",
                  fontWeight: 900,
                  fontSize: 18,
                  letterSpacing: "0.2em",
                  borderRadius: 4,
                  WebkitPrintColorAdjust: "exact",
                  printColorAdjust: "exact",
                }}>💳 カード決済</div>
              </div>
            )}
            <div style={{ background: "#f9fafb", border: "1px solid #ddd", borderRadius: 4, padding: 16, margin: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14 }}>ご請求金額（税込）</span>
                <span style={{ fontSize: 28, fontWeight: 800 }}>{fmtYen(inv.total)}</span>
              </div>
            </div>
            <p style={{ fontSize: 11, color: "#666", margin: "16px 0 6px" }}>下記のとおりご請求申し上げます。</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={th}>品目</th>
                  <th style={{ ...th, textAlign: "right", width: 80 }}>数量</th>
                  <th style={{ ...th, textAlign: "right", width: 110 }}>金額（税抜）</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((it, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={tdC}>{it.name}</td>
                    <td style={{ ...tdC, textAlign: "right" }}>{it.qty}</td>
                    <td style={{ ...tdC, textAlign: "right" }}>{fmtYen(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f9fafb" }}>
                  <td colSpan={2} style={{ ...tdC, textAlign: "right" }}>小計</td>
                  <td style={{ ...tdC, textAlign: "right" }}>{fmtYen(inv.subtotal)}</td>
                </tr>
                <tr style={{ background: "#f9fafb" }}>
                  <td colSpan={2} style={{ ...tdC, textAlign: "right" }}>消費税</td>
                  <td style={{ ...tdC, textAlign: "right" }}>{fmtYen(inv.tax)}</td>
                </tr>
                <tr style={{ background: "#f9fafb" }}>
                  <td colSpan={2} style={{ ...tdC, textAlign: "right", fontWeight: 700 }}>合計</td>
                  <td style={{ ...tdC, textAlign: "right", fontWeight: 700, fontSize: 14 }}>{fmtYen(inv.total)}</td>
                </tr>
              </tfoot>
            </table>
          </main>
        )
      })}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          /* ナビ・ヘッダーを完全に非表示 */
          .admin-layout-header,
          .mobile-bottom-nav,
          nav.mobile-bottom-nav,
          .mobile-spacer {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
          }
          @page { size: A4; margin: 10mm; }
          /* 請求書ごとに改ページ（最終ページは除く） */
          .print-page { break-after: page; }
          .print-page-last { break-after: auto !important; }
          /* テーブル行が途中で切れないようにする */
          .print-page table { break-inside: auto; }
          .print-page table thead { display: table-header-group; }
          .print-page table tr { break-inside: avoid; break-after: auto; }
          /* フッター（小計/消費税/合計）は一緒に保つ */
          .print-page table tfoot { break-inside: avoid; }
          /* ヘッダーブロックを明細と分離させない */
          .print-page header { break-inside: avoid; break-after: avoid; }
        }
      `}</style>
    </>
  )
}

const th: React.CSSProperties = { padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #ddd", fontSize: 11, color: "#555" }
const tdC: React.CSSProperties = { padding: "6px 8px", fontSize: 12 }
