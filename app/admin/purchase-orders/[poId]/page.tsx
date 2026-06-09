"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"

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
  const [receivingIds, setReceivingIds] = useState<Set<string>>(new Set())  // 行ごとの入荷処理中ロック
  const [showPrices, setShowPrices] = useState(false)  // 価格表示トグル（デフォルトは非表示。仕入先に伝えない方針）

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
    // 連打防止: 同じ行が処理中なら無視（state の古い received_quantity で diff を再計算してしまう競合防止）
    if (receivingIds.has(itemId)) return
    setReceivingIds(prev => new Set(prev).add(itemId))
    try {
      // ★ DB から最新の received_quantity を取得して diff を計算（state スナップショットだと連打で重複加算）
      const { data: latestItem } = await supabase
        .from("purchase_order_items")
        .select("product_id,received_quantity")
        .eq("id", itemId)
        .single()
      if (!latestItem) { alert("明細が見つかりません"); return }

      const beforeReceived = Number(latestItem.received_quantity || 0)
      const diff = qty - beforeReceived

      // 1) received_quantity 更新
      const { error } = await supabase.from("purchase_order_items").update({ received_quantity: qty }).eq("id", itemId)
      if (error) { alert("更新失敗: " + error.message); return }

      // 2) 在庫加算（diff のみ）
      if (autoStock && latestItem.product_id && diff !== 0) {
        const { data: prod } = await supabase.from("products").select("stock").eq("id", latestItem.product_id).single()
        if (prod) {
          const newStock = Number(prod.stock || 0) + diff
          await supabase.from("products").update({ stock: newStock }).eq("id", latestItem.product_id)
          // stock_movements 履歴
          try {
            await supabase.from("stock_movements").insert({
              product_id: latestItem.product_id,
              movement_type: diff > 0 ? "入庫" : "入庫修正",
              quantity: diff,
              before_stock: Number(prod.stock || 0),
              after_stock: newStock,
              ref_type: "purchase_order_item",
              ref_id: itemId,
              reason: `発注書 ${po?.po_number || poId.slice(0,8)} 入荷`,
            })
          } catch { /* テーブル無いとスキップ */ }
        }
      }

      // 3) 全行入荷済みなら status を 入荷済 に（最新 DB から判定）
      const { data: re } = await supabase.from("purchase_order_items").select("quantity,received_quantity").eq("purchase_order_id", poId)
      if (re) {
        const all = re.every(r => Number(r.received_quantity || 0) >= Number(r.quantity))
        const some = re.some(r => Number(r.received_quantity || 0) > 0)
        const newStatus = all ? "入荷済" : (some ? "部分入荷" : po?.status)
        if (newStatus && newStatus !== po?.status) {
          await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", poId)
        }
      }

      // 4) 最後に1回だけ fetch（旧コードは2回呼んでいた）
      await fetchData()
    } finally {
      setReceivingIds(prev => { const n = new Set(prev); n.delete(itemId); return n })
    }
  }

  async function deletePO() {
    if (!po) return
    if (!confirm("この発注書を完全に削除しますか？（取消の方が安全です）")) return
    await supabase.from("purchase_order_items").delete().eq("purchase_order_id", po.id)
    await supabase.from("purchase_orders").delete().eq("id", po.id)
    router.push("/admin/purchase-orders")
  }

  // メール送信: 仕入先のメールアドレス宛に発注書本文を mailto: で開く
  async function sendByEmail() {
    if (!po) return
    if (!supplier?.email) {
      alert("仕入先にメールアドレスが登録されていません。\n仕入先マスタで設定してください。")
      return
    }
    const total = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0)
    const lines: string[] = []
    lines.push(`${supplier.name} 御中`)
    lines.push("")
    lines.push("いつもお世話になっております。")
    lines.push(`下記のとおり発注いたします。ご確認のほどよろしくお願いいたします。`)
    lines.push("")
    lines.push(`■ 発注書番号: ${po.po_number || po.id.slice(0, 8)}`)
    if (po.ordered_at) lines.push(`■ 発注日: ${new Date(po.ordered_at).toLocaleDateString("ja-JP")}`)
    if (po.expected_at) lines.push(`■ 納期希望: ${new Date(po.expected_at).toLocaleDateString("ja-JP")}`)
    lines.push("")
    lines.push("【明細】")
    items.forEach((i, idx) => {
      lines.push(`  ${idx + 1}. ${i.product_name} × ${i.quantity}`)
    })
    lines.push("")
    lines.push("※ 単価・金額は貴社見積書にてご確認ください。")
    if (po.note) { lines.push(""); lines.push(`備考: ${po.note}`) }
    lines.push("")
    lines.push("────────────────────")
    lines.push(COMPANY.name)
    lines.push(`〒${COMPANY.postalCode} ${COMPANY.address}`)
    lines.push(`TEL: ${COMPANY.phone}  FAX: ${COMPANY.fax}`)
    lines.push("────────────────────")
    const subject = `【発注書】${po.po_number || ""} ${COMPANY.name}より`
    const body = lines.join("\r\n")
    const mailto = `mailto:${encodeURIComponent(supplier.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.location.href = mailto
    // 送信記録（あくまでメール起動の記録、実際の送信は確認できない）
    try {
      await supabase.from("email_logs").insert({
        to_email: supplier.email,
        subject,
        body,
        related_type: "purchase_order",
        related_id: po.id,
        status: "mailto_opened",
      })
      // PO に sent_method/sent_at を記録
      await supabase.from("purchase_orders").update({
        sent_method: "メール",
        sent_at: new Date().toISOString(),
      }).eq("id", po.id)
      fetchData()
    } catch { /* テーブル無くてもOK */ }
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
          <button onClick={sendByEmail} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded" title={supplier?.email ? `${supplier.email} 宛に送信` : "仕入先のメール未設定"}>✉ メール送付</button>
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
          <div style={{ flexShrink: 0, fontSize: 11, lineHeight: 1.6, position: "relative", paddingRight: 70 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{COMPANY.name}</p>
            <p style={{ margin: 0 }}>〒{COMPANY.postalCode}</p>
            <p style={{ margin: 0 }}>{COMPANY.address}</p>
            <p style={{ margin: 0 }}>TEL {COMPANY.phone}</p>
            {COMPANY.fax && <p style={{ margin: 0 }}>FAX {COMPANY.fax}</p>}
            {/* 印影 */}
            <div style={{ position: "absolute", top: 0, right: 0 }}>
              <Seal size={64} />
            </div>
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

        {items.length === 0 && (
          <div className="no-print" style={{ marginTop: 16, padding: 16, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#92400e" }}>⚠️ この発注書には明細がありません</p>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#78350f" }}>
              これは <strong>RLS（行レベルセキュリティ）エラー</strong> で明細作成が失敗した残骸の可能性があります。
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#78350f" }}>
              <strong>対処:</strong>
            </p>
            <ol style={{ margin: "4px 0 8px 20px", fontSize: 12, color: "#78350f", lineHeight: 1.7 }}>
              <li>右上の「削除」ボタンでこの空発注書を削除</li>
              <li>Supabase Studio で <code style={{ background: "#fff", padding: "2px 6px", borderRadius: 3 }}>db/migrations/2026-05-05_disable_rls_again.sql</code> を実行</li>
              <li>もう一度 <a href="/admin/purchase-orders/suggest" style={{ color: "#1d4ed8", textDecoration: "underline" }}>発注書の自動提案</a> から作り直す</li>
            </ol>
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 11, color: "#92400e", cursor: "pointer" }}>SQL を直接コピー（クリックで展開）</summary>
              <pre style={{ marginTop: 6, padding: 8, background: "#fff", border: "1px solid #fde68a", borderRadius: 4, fontSize: 10, overflow: "auto", maxHeight: 200 }}>{`ALTER TABLE IF EXISTS purchase_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS purchase_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stock_movements DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stocktakes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stocktake_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sales_reps DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invoice_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS clinic_product_prices DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS order_drafts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS company_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notification_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bank_imports DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bank_payment_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS delivery_slips DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS product_suppliers DISABLE ROW LEVEL SECURITY;`}</pre>
            </details>
          </div>
        )}
        {/* 価格表示トグル（社内確認用に必要なときだけ） */}
        <div className="no-print" style={{ marginTop: 12, fontSize: 11 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#666" }}>
            <input type="checkbox" checked={showPrices} onChange={e => setShowPrices(e.target.checked)} />
            社内管理用に価格を表示する
          </label>
          <span style={{ marginLeft: 8, fontSize: 10, color: "#999" }}>
            ※ 仕入先に価格は伝えません。印刷物・メールには出力されません。
          </span>
        </div>

        <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={th}>商品名</th>
              <th style={{ ...th, textAlign: "right", width: 60 }}>数量</th>
              {showPrices && (
                <>
                  <th style={{ ...th, textAlign: "right", width: 80 }} className="no-print">単価</th>
                  <th style={{ ...th, textAlign: "right", width: 90 }} className="no-print">金額</th>
                </>
              )}
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
                {showPrices && (
                  <>
                    <td style={{ ...tdCell, textAlign: "right" }} className="no-print">{fmtYen(i.unit_price)}</td>
                    <td style={{ ...tdCell, textAlign: "right", fontWeight: 700 }} className="no-print">{fmtYen(Number(i.quantity) * Number(i.unit_price))}</td>
                  </>
                )}
                <td style={{ ...tdCell, textAlign: "right" }} className="no-print">
                  <input type="number" defaultValue={i.received_quantity || 0}
                    onBlur={(e) => updateReceived(i.id, Number(e.target.value))}
                    disabled={receivingIds.has(i.id)}
                    className={"w-16 px-1 py-0.5 border border-gray-200 rounded text-xs text-right " + (receivingIds.has(i.id) ? "opacity-50 bg-gray-100" : "")} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f9fafb" }} className="no-print">
              <td colSpan={showPrices ? 3 : 2} style={{ ...tdCell, textAlign: "right", fontWeight: 700 }}>
                {showPrices ? "合計（社内管理用）" : "入荷進捗"}
              </td>
              {showPrices && (
                <td style={{ ...tdCell, textAlign: "right", fontWeight: 700, fontSize: 14 }}>{fmtYen(total)}</td>
              )}
              <td style={tdCell}>{receivedTotal} / {expectedTotal}</td>
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
          .mobile-bottom-nav { display: none !important; }
          nav { display: none !important; }
          .print-area { box-shadow: none !important; border: none !important; max-width: none !important; }
          @page { size: A4 portrait; margin: 10mm; }
        }
      `}</style>
    </div>
  )
}

const th: React.CSSProperties = { padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #ddd", fontSize: 11, color: "#555" }
const td: React.CSSProperties = { padding: "4px 8px", background: "#f9fafb", fontSize: 11, color: "#555", width: 80, borderRight: "1px solid #eee" }
const td2: React.CSSProperties = { padding: "4px 8px", fontSize: 11, color: "#111", borderRight: "1px solid #eee" }
const tdCell: React.CSSProperties = { padding: "6px 8px", fontSize: 12 }
