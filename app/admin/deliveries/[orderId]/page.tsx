"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import DeliveryNoteSheet from "@/app/components/DeliveryNoteSheet"

type Order = { id: string; clinic_id: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null; sales_rep: string | null; note: string | null; status: string }
type Item = { id: string; order_id: string; product_name: string | null; quantity: number; price: number }
type Clinic = { id: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null }

export default function DeliveryDetail({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { (async () => {
    const { data: o } = await supabase.from("orders").select("*").eq("id", orderId).single()
    if (!o) { setLoading(false); return }
    setOrder(o as Order)
    const { data: i } = await supabase.from("order_items").select("*").eq("order_id", orderId)
    setItems((i as Item[]) || [])
    if (o.clinic_id) {
      const { data: c } = await supabase.from("clinics").select("*").eq("id", o.clinic_id).single()
      setClinic(c as Clinic)
    }
    setLoading(false)
  })() }, [orderId])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>
  if (!order) return <p className="text-red-600 text-center py-12">納品書が見つかりません</p>

  // 商品が多い場合、複数枚に分割（1枚あたり最大10品）
  const ITEMS_PER_PAGE = 10
  const pages: Item[][] = []
  for (let i = 0; i < Math.max(1, items.length); i += ITEMS_PER_PAGE) {
    pages.push(items.slice(i, i + ITEMS_PER_PAGE))
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 no-print mb-3 px-3">
        <Link href="/admin/deliveries" className="text-xs text-gray-500 underline">← 一覧</Link>
        <button onClick={() => window.print()} className="text-xs px-4 py-2 bg-gray-900 text-white rounded font-bold">🖨 印刷（A4・上下2分割）</button>
      </div>

      {pages.map((pageItems, idx) => (
        <DeliveryNoteSheet
          key={idx}
          order={order}
          items={pageItems}
          clinic={clinic}
        />
      ))}

      <style jsx global>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 0; }
        }
        @media screen {
          body { background: #f3f4f6; }
          .delivery-page { box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 20px !important; }
        }
      `}</style>
    </div>
  )
}
