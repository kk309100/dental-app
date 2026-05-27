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

// 半ページ（148.5mm）のうち、固定10行を表示（DeliveryNoteSheet の FIXED_ROWS と合わせる）
const ITEMS_PER_PAGE = 10

type Sheet = {
  order: Order
  items: Item[]       // このページに表示する商品
  allItems: Item[]    // 注文全体の商品（合計金額計算用）
  clinic: Clinic | null
  pageNum: number
  totalPages: number
  isLastSheet: boolean
}

function BulkPrint() {
  const sp = useSearchParams()
  const ids = (sp.get("ids") || "").split(",").filter(Boolean)
  const merge = sp.get("merge") === "1"  // 同一医院をまとめて1枚に
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
  items.forEach(i => {
    if (!itemsByOrder.has(i.order_id)) itemsByOrder.set(i.order_id, [])
    itemsByOrder.get(i.order_id)!.push(i)
  })

  // 全シートを事前に計算（最後のシートを特定するため）
  const sheets: Sheet[] = []

  if (merge) {
    // 同一医院の注文をまとめて1枚の納品書に
    const groupsByClinic = new Map<string, Order[]>()
    orders.forEach(o => {
      if (!groupsByClinic.has(o.clinic_id)) groupsByClinic.set(o.clinic_id, [])
      groupsByClinic.get(o.clinic_id)!.push(o)
    })
    groupsByClinic.forEach((groupOrders, clinicId) => {
      const cl = clinicBy.get(clinicId) || null
      // 全注文の商品を結合
      const allItems = groupOrders.flatMap(o => itemsByOrder.get(o.id) || [])
      // 複数伝票番号を「・」でつなぐ
      const numbers = groupOrders.map(o => o.delivery_number || o.id.slice(0, 8)).join("・")
      // 代表注文（日付は最新のものを使用）
      const latestOrder = [...groupOrders].sort((a, b) =>
        (b.delivered_at || b.created_at).localeCompare(a.delivered_at || a.created_at)
      )[0]
      const mergedOrder: Order = { ...latestOrder, delivery_number: numbers }
      const chunks: Item[][] = []
      for (let i = 0; i < Math.max(1, allItems.length); i += ITEMS_PER_PAGE) {
        chunks.push(allItems.slice(i, i + ITEMS_PER_PAGE))
      }
      chunks.forEach((chunk, idx) => {
        sheets.push({
          order: mergedOrder,
          items: chunk,
          allItems,
          clinic: cl,
          pageNum: idx + 1,
          totalPages: chunks.length,
          isLastSheet: false,
        })
      })
    })
  } else {
    // 通常：注文ごとに1枚
    orders.forEach(o => {
      const allItems = itemsByOrder.get(o.id) || []
      const cl = clinicBy.get(o.clinic_id) || null
      const chunks: Item[][] = []
      for (let i = 0; i < Math.max(1, allItems.length); i += ITEMS_PER_PAGE) {
        chunks.push(allItems.slice(i, i + ITEMS_PER_PAGE))
      }
      chunks.forEach((chunk, idx) => {
        sheets.push({
          order: o,
          items: chunk,
          allItems,
          clinic: cl,
          pageNum: idx + 1,
          totalPages: chunks.length,
          isLastSheet: false,
        })
      })
    })
  }

  if (sheets.length > 0) {
    sheets[sheets.length - 1].isLastSheet = true
  }

  // merge時の医院数（バナー表示用）
  const clinicCount = merge
    ? new Set(orders.map(o => o.clinic_id)).size
    : orders.length

  return (
    <>
      <div className="no-print p-4 bg-yellow-50 border-b border-yellow-200 sticky top-0">
        <button onClick={() => window.print()} className="px-4 py-2 bg-gray-900 text-white text-sm rounded mr-2">🖨 印刷</button>
        <button onClick={() => window.close()} className="px-4 py-2 bg-gray-200 text-sm rounded">閉じる</button>
        <span className="ml-3 text-xs text-gray-700">
          {merge
            ? `${clinicCount}医院・${orders.length}注文 → ${sheets.length}枚の納品書（医院ごとにまとめ）`
            : `${orders.length}件の納品書（A4 1枚に得意先控+自社控）`}
        </span>
      </div>
      {sheets.map((s, i) => (
        <DeliveryNoteSheet
          key={i}
          order={s.order}
          items={s.items}
          allItems={s.allItems}
          clinic={s.clinic}
          pageNum={s.pageNum}
          totalPages={s.totalPages}
          isLastSheet={s.isLastSheet}
        />
      ))}
      <style jsx global>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 0; }

          /* ナビ・ヘッダーを完全に非表示（!important 競合対策で visibility も指定） */
          .admin-layout-header,
          .mobile-bottom-nav,
          nav.mobile-bottom-nav,
          .mobile-spacer {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
          }

          /* 納品書1枚 = A4 1ページに収める（最後のシートは改ページしない） */
          .delivery-page {
            break-after: page;
            page-break-after: always;
            overflow: hidden !important;
            height: 297mm !important;
          }
          .delivery-page-last {
            break-after: auto !important;
            page-break-after: auto !important;
          }

          /* 上（納品書）と下（納品書控え）をちょうど半分に */
          .delivery-half {
            height: 148.5mm !important;
            min-height: unset !important;
            overflow: hidden !important;
          }
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
