"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { COMPANY } from "@/lib/company"

type PO = {
  id: string; po_number: string | null; supplier_id: string | null; status: string
  ordered_at: string | null; expected_at: string | null; total_amount: number | null
  note: string | null; sent_method: string | null; sent_at: string | null
}
type Item = {
  id: string; purchase_order_id: string; product_id: string | null; product_name: string | null
  quantity: number; unit_price: number; received_quantity: number | null; note: string | null
}
type Supplier = { id: string; name: string; address: string | null; phone: string | null; fax: string | null; contact: string | null }

export default function POPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = use(params)
  const router = useRouter()
  const [po, setPo] = useState<PO | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")

  useEffect(() => { fetchData() }, [poId])

  async function fetchData() {
    setLoading(true)
    const { data: p, error: e1 } = await supabase.from("purchase_orders").select("*").eq("id", poId).single()
    if (e1 || !p) { setErr("発注書が見つかりません"); setLoading(false); return }
    setPo(p as PO)
    const { data: it } = await supabase.from("purchase_order_items").select("*").eq("purchase_order_id", poId)
    setItems((it as Item[]) || [])
    if (p.supplier_id) {
      const { data: s } = await supabase.from("suppliers").select("*").eq("id", p.supplier_id).single()
      setSupplier(s as Supplier | null)
    }
    setLoading(false)
  }

  async function setStatus(status: string) {
    if (!po) return
    if (status === "取消" && !confirm("この発注書を取消しますか？")) return
    const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", po.id)
    if (error) { alert("更新失敗: " + error.message); return }
    fetchData()
  }

  async function updateReceived(itemId: string, qty: number, autoStock = true) {
    const { error } = await supabase.from("purchase_order_items").update({ received_quantity: qty }).eq("id", itemId)
    if (error) { alert("更新失敗: " + error.message); return }
    if (autoStock) {
      // 商品マスタの stock を加算（差分のみ）
      const item = items.find(i => i.id === itemId)
      if (item?.product_id) {
        const diff = qty - Number(item.received_quantity || 0)
        if (diff !== 0) {
          // 現在 stock 取得 → 加算
          const { data: prod } = await supabase.from("products").select("stock").eq("id", item.product_id).single()
          if (prod) {
            const newStock = Number(prod.stock || 0) + diff
            await supabase.from("products").update({ stock: newStock }).eq("id", item.product_id)
          }
        }
      }
    }
    fetchData()
    // 全行入荷済みなら status を 入荷済 に
    const { data: re } = await supabase.from("purchase_order_items").select("quantity,received_quantity").eq("purchase_order_id", poId)
    if (re) {
      const all = re.every(r => Number(r.received_quantity || 0) >= Number(r.quantity))
      const some = re.some(r => Number(r.received_quantity || 0) > 0)
      const newStatus = all ? "入荷済" : (some ? "部分入荷" : po?.status)
      if (newStatus && newStatus !== po?.status) {
        await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", poId)
      }
    }
    fetchData()
  }

  async function deletePO() {
    if (!po) return
    if (!confirm("この発注書を完全に削除しますか？（取消の方が安全です）")) return
    await supabase.from("purchase_order_items").delete().eq("purchase_order_id", po.id)
    await supabase.from("purchase_orders").delete().eq("id", po.id)
    router.push("/admin/purchase-orders")
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>
  if (err || !po) return <p className="text-red-600 text-center py-12">{err}</p>

  const total = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0)
  const receivedTotal = items.reduce((s, i) => s + Number(i.received_quantity || 0), 0)
  const expectedTotal = items.reduce((s, i) => s + Number(i.quantity || 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
        <Link href="/admin/purchase-orders" className="text-xs text-gray-500 underline">← 一覧</Link>
        <div className="flex items-center gap-2">
          {po.status === "下書き" && <button onClick={() => setStatus("発注済")} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded">発注済にする</button>}
          {po.status === "発注済" && <button onClick={() => setStatus("部分入荷")} className="text-xs px-3 py-1.5 bg-amber-600 text-white rounded">部分入荷</button>}
          {(po.status === "発注済" || po.status === "部分入荷") && <button onClick={() => setStatus("入荷済")} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded">入荷完了</button>}
          {po.status !== "取消" && po.status !== "入荷済" && <button onClick={() => setStatus("取消")} className="text-xs px-3 py-1.5 bg-gray-200 text-gray-700 rounded">取消</button>}
          <button onClick={() => window.print()} className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded">🖨 印刷</button>
          <button onClick={deletePO} className="text-xs px-3 py-1.5 text-red-600 hover:bg-red-50 rounded">削除</button>
        </div>
      </div>

      {/* 印刷エリア */}
      <main className="bg-white rounded-lg p-8 max-w-3xl mx-auto print-area" style={{ border: "1px solid #e8eaed" }}>
        <header style={{ borderBottom: "2px solid #111", paddingBottom: 8 }}>
          <h1 style={{ fontSize: 28, letterSpacing: "0.3em", margin: "20px 0 4px", textAlign: "center" }}>発 注 書</h1>
          <p style={{ textAlign: "center", margin: 0, fontSize: 11, color: "#666" }}>No. {po.po_number || po.id.slice(0, 8)}</p>
        </header>

        <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 6 }}>
              {supplier?.name || "(仕入先未設定)"} 御中
            </p>
            {supplier?.address && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#666" }}>{supplier.address}</p>}
            {supplier?.phone && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>TEL {supplier.phone}{supplier.fax && ` / FAX ${supplier.fax}`}</p>}
            {supplier?.contact && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>担当: {supplier.contact}</p>}
          </div>
          <div style={{ flexShrink: 0, fontSize: 11, lineHeight: 1.6 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{COMPANY.name}</p>
            <p style={{ margin: 0 }}>〒{COMPANY.postalCode}</p>
            <p style={{ margin: 0 }}>{COMPANY.address}</p>
            <p style={{ margin: 0 }}>TEL {COMPANY.phone}</p>
          </div>
        </div>

        <table style={{ width: "100%", marginTop: 18, borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            <tr>
              <td style={td}>発注日</td><td style={td2}>{po.ordered_at ? new Date(po.ordered_at).toLocaleDateString("ja-JP") : "—"}</td>
              <td style={td}>納期希望</td><td style={td2}>{po.expected_at ? new Date(po.expected_at).toLocaleDateString("ja-JP") : "—"}</td>
            </tr>
            <tr>
              <td style={td}>状態</td><td style={td2}>{po.status}</td>
              <td style={td}>送付方法</td><td style={td2}>{po.sent_method || "—"}</td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={th}>商品名</th>
              <th style={{ ...th, textAlign: "right", width: 60 }}>数量</th>
              <th style={{ ...th, textAlign: "right", width: 80 }}>単価</th>
              <th style={{ ...th, textAlign: "right", width: 90 }}>金額</th>
              <th style={{ ...th, textAlign: "right", width: 80 }} className="no-print">入荷</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={tdCell}>
                  {i.product_name}
                  {i.note && <p style={{ margin: "2px 0 0", fontSize: 9, color: "#999" }}>{i.note}</p>}
                </td>
                <td style={{ ...tdCell, textAlign: "right" }}>{i.quantity}</td>
                <td style={{ ...tdCell, textAlign: "right" }}>{fmtYen(i.unit_price)}</td>
                <td style={{ ...tdCell, textAlign: "right", fontWeight: 700 }}>{fmtYen(Number(i.quantity) * Number(i.unit_price))}</td>
                <td style={{ ...tdCell, textAlign: "right" }} className="no-print">
                  <input type="number" defaultValue={i.received_quantity || 0}
                    onBlur={(e) => updateReceived(i.id, Number(e.target.value))}
                    className="w-16 px-1 py-0.5 border border-gray-200 rounded text-xs text-right" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f9fafb" }}>
              <td colSpan={3} style={{ ...tdCell, textAlign: "right", fontWeight: 700 }}>合計</td>
              <td style={{ ...tdCell, textAlign: "right", fontWeight: 700, fontSize: 14 }}>{fmtYen(total)}</td>
              <td className="no-print" style={tdCell}>{receivedTotal} / {expectedTotal}</td>
            </tr>
          </tfoot>
        </table>

        {po.note && (
          <div style={{ marginTop: 16, padding: 10, background: "#f9fafb", borderRadius: 4, fontSize: 11, color: "#555" }}>
            備考: {po.note}
          </div>
        )}
      </main>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          .print-area { box-shadow: none !important; border: none !important; max-width: none !important; }
        }
      `}</style>
    </div>
  )
}

const th: React.CSSProperties = { padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #ddd", fontSize: 11, color: "#555" }
const td: React.CSSProperties = { padding: "4px 8px", background: "#f9fafb", fontSize: 11, color: "#555", width: 80, borderRight: "1px solid #eee" }
const td2: React.CSSProperties = { padding: "4px 8px", fontSize: 11, color: "#111", borderRight: "1px solid #eee" }
const tdCell: React.CSSProperties = { padding: "6px 8px", fontSize: 12 }
