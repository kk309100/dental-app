"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import DeliveryNoteSheet from "@/app/components/DeliveryNoteSheet"

type Order = { id: string; clinic_id: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null; note: string | null }
type Item = { id: string; order_id: string; product_name: string | null; quantity: number; price: number }
type Clinic = { id: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null }

export default function BulkPrintWrapper() {
  return (
    <Suspense fallback={<p>読み込み中…</p>}>
      <BulkPrint />
    </Suspense>
  )
}

// 商品名の折り返しを考慮し、Half（約144mm）に確実に収まる件数に設定
const ITEMS_PER_PAGE = 6

function BulkPrint() {
  const sp = useSearchParams()
  const ids = (sp.get("ids") || "").split(",").filter(Boolean)
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])

  useEffect(() => {
    if (ids.length === 0) return
    let cancelled = false
    let printTimer: ReturnType<typeof setTimeout> | null = null
    Promise.all([
      supabase.from("orders").select("*").in("id", ids),
      supabase.from("order_items").select("*").in("order_id", ids),
      supabase.from("clinics").select("*").limit(50000),
    ]).then(([o, i, c]) => {
      if (cancelled) return
      setOrders((o.data as Order[]) || [])
      setItems((i.data as Item[]) || [])
      setClinics((c.data as Clinic[]) || [])
      printTimer = setTimeout(() => { if (!cancelled) window.print() }, 800)
    })
    return () => {
      cancelled = true
      if (printTimer) clearTimeout(printTimer)
    }
  }, [ids.join(",")])

  const clinicBy = new Map(clinics.map(c => [c.id, c]))
  const itemsByOrder = new Map<string, Item[]>()
  items.forEach(i => { if (!itemsByOrder.has(i.order_id)) itemsByOrder.set(i.order_id, []); itemsByOrder.get(i.order_id)!.push(i) })

  return (
    <>
      <div className="no-print p-4 bg-yellow-50 border-b border-yellow-200 sticky top-0">
        <button onClick={() => window.print()} className="px-4 py-2 bg-gray-900 text-white text-sm rounded mr-2">🖨 印刷</button>
        <button onClick={() => window.close()} className="px-4 py-2 bg-gray-200 text-sm rounded">閉じる</button>
        <span className="ml-3 text-xs text-gray-700">{orders.length}件の納品書（A4 1枚に得意先控+自社控）</span>
      </div>
      {orders.map(o => {
        const its = itemsByOrder.get(o.id) || []
        const cl = clinicBy.get(o.clinic_id) || null
        const pages: Item[][] = []
        for (let i = 0; i < Math.max(1, its.length); i += ITEMS_PER_PAGE) {
          pages.push(its.slice(i, i + ITEMS_PER_PAGE))
        }
        return (
          <div key={o.id}>
            {pages.map((pi, idx) => (
              <DeliveryNoteSheet key={idx} order={o} items={pi} clinic={cl} />
            ))}
          </div>
        )
      })}
      <style jsx global>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 0; }
          /* 納品書1枚 = A4 1ページに収める */
          .delivery-page {
            break-after: page !important;
            overflow: hidden !important;
            height: 297mm !important;
            page-break-after: always !important;
          }
          /* 上下それぞれの Half を固定高さに */
          .delivery-half {
            height: calc((297mm - 8mm) / 2) !important;
            min-height: unset !important;
            overflow: hidden !important;
          }
          /* 切り取り線は改ページさせない */
          .cut-line { break-before: avoid !important; break-inside: avoid !important; }
          /* テーブル行を途中で切らない */
          .delivery-page table tr { break-inside: avoid; }
        }
        @media screen {
          body { background: #f3f4f6; }
          .delivery-page { box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 20px !important; }
        }
      `}</style>
    </>
  )
}
