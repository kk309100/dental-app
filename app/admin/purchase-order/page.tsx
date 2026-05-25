"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import Seal from "@/app/components/Seal"
import { COMPANY } from "@/lib/company"
import { fetchSuppliersByUsage, supplierOptionLabel, type Supplier } from "@/lib/supplier-sort"

type Order = { id: string; clinic_id: string; created_at: string; delivery_number: string | null }
type OrderItem = {
  id: string; order_id: string; product_id: string | null
  product_name: string | null; quantity: number; price: number
  purchase_status: string | null
  purchased_at: string | null
}
type Product = { id: string; name: string; manufacturer: string | null; unit: string | null; cost: number | null }
type Clinic = { id: string; name: string }

type Row = {
  item_id: string
  order_id: string
  product_id: string
  product_name: string
  manufacturer: string
  quantity: number
  unit: string
  cost: number
  clinic_name: string
  delivery_number: string
  created_at: string
  purchase_status: string  // "未発注" | "発注済み"
  purchased_at: string | null
}

export default function PurchaseOrderPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"unbought" | "bought" | "all">("unbought")
  const [makerFilter, setMakerFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [printMode, setPrintMode] = useState<string | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showCreatePOModal, setShowCreatePOModal] = useState(false)
  const [makerToSupplier, setMakerToSupplier] = useState<Record<string, string>>({})
  const [poBusy, setPoBusy] = useState(false)
  const [createdPOs, setCreatedPOs] = useState<{ id: string; po_number: string; supplier_name: string }[]>([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [o, i, p, c] = await Promise.all([
      supabase.from("orders").select("id,clinic_id,created_at,delivery_number").limit(50000),
      supabase.from("order_items").select("*").limit(50000),
      supabase.from("products").select("id,name,manufacturer,unit,cost").limit(50000),
      supabase.from("clinics").select("id,name").limit(50000),
    ])
    setOrders((o.data as Order[]) || [])
    setOrderItems((i.data as OrderItem[]) || [])
    setProducts((p.data as Product[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setSuppliers(await fetchSuppliersByUsage("id,name"))
    setLoading(false)
  }

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const clinicById = useMemo(() => new Map(clinics.map((c) => [c.id, c])), [clinics])

  const allRows: Row[] = useMemo(() => orderItems.map((it) => {
    const order = it.order_id ? orderById.get(it.order_id) : null
    const product = it.product_id ? productById.get(it.product_id) : null
    const clinic = order ? clinicById.get(order.clinic_id) : null
    return {
      item_id: it.id,
      order_id: it.order_id,
      product_id: it.product_id || "",
      product_name: it.product_name || product?.name || "(商品名なし)",
      manufacturer: product?.manufacturer || "メーカー未設定",
      quantity: Number(it.quantity || 0),
      unit: product?.unit || "個",
      cost: Number(product?.cost || it.price || 0),
      clinic_name: clinic?.name || "医院不明",
      delivery_number: order?.delivery_number || "—",
      created_at: order?.created_at || "",
      purchase_status: it.purchase_status || "未発注",
      purchased_at: it.purchased_at,
    }
  }), [orderItems, orderById, productById, clinicById])

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")

  const filtered = useMemo(() => {
    const k = norm(search)
    return allRows.filter((r) => {
      if (statusFilter === "unbought" && r.purchase_status !== "未発注") return false
      if (statusFilter === "bought" && r.purchase_status !== "発注済み") return false
      if (makerFilter !== "all" && r.manufacturer !== makerFilter) return false
      if (!k) return true
      return norm(`${r.product_name} ${r.manufacturer} ${r.clinic_name} ${r.delivery_number}`).includes(k)
    }).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [allRows, search, statusFilter, makerFilter])

  const makers = useMemo(() => {
    const set = new Set(allRows.map((r) => r.manufacturer))
    return ["all", ...Array.from(set).sort()]
  }, [allRows])

  // 集計
  const counts = useMemo(() => ({
    unbought: allRows.filter((r) => r.purchase_status === "未発注").length,
    bought: allRows.filter((r) => r.purchase_status === "発注済み").length,
  }), [allRows])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAll() { setSelectedIds(new Set(filtered.map((r) => r.item_id))) }
  function clearSel() { setSelectedIds(new Set()) }

  // 選択行をメーカー別にグループ化
  const selectedByMaker = useMemo(() => {
    const m = new Map<string, Row[]>()
    allRows.filter(r => selectedIds.has(r.item_id)).forEach(r => {
      if (!m.has(r.manufacturer)) m.set(r.manufacturer, [])
      m.get(r.manufacturer)!.push(r)
    })
    return Array.from(m.entries())
  }, [allRows, selectedIds])

  function openCreatePOModal() {
    if (selectedIds.size === 0) { alert("選択行がありません"); return }
    // メーカー名で suppliers を自動マッチ（部分一致）
    const auto: Record<string, string> = {}
    const norm = (s: string) => String(s || "").toLowerCase().normalize("NFKC")
    selectedByMaker.forEach(([maker]) => {
      const m = norm(maker)
      const found = suppliers.find(s => {
        const sn = norm(s.name)
        return sn.includes(m) || m.includes(sn)
      })
      if (found) auto[maker] = found.id
    })
    setMakerToSupplier(auto)
    setCreatedPOs([])
    setShowCreatePOModal(true)
  }

  async function generatePoNumber() {
    const now = new Date()
    const y = now.getFullYear()
    const mo = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    const { data } = await supabase.from("purchase_orders").select("id")
      .gte("created_at", `${y}-${mo}-${d}T00:00:00`)
      .lte("created_at", `${y}-${mo}-${d}T23:59:59`)
    const count = (data?.length || 0) + 1
    const rand = Math.floor(Math.random() * 900) + 100
    return `PO-${y}${mo}${d}-${String(count).padStart(3, "0")}-${rand}`
  }

  async function createPOs() {
    setPoBusy(true)
    const created: { id: string; po_number: string; supplier_name: string }[] = []
    const allItemIdsToMark: string[] = []
    try {
      for (const [maker, rows] of selectedByMaker) {
        const supplierId = makerToSupplier[maker] || null
        const supName = supplierId ? (suppliers.find(s => s.id === supplierId)?.name || maker) : maker
        const total = rows.reduce((s, r) => s + r.cost * r.quantity, 0)
        const poNumber = await generatePoNumber()
        // PO ヘッダ作成
        const { data: po, error: poErr } = await supabase.from("purchase_orders").insert([{
          po_number: poNumber,
          supplier_id: supplierId,
          status: "発注済",
          ordered_at: new Date().toISOString(),
          total_amount: total,
          note: `${maker} 向け（${rows.length}行集約）`,
        }]).select().single()
        if (poErr || !po) { alert(`発注書作成失敗: ${poErr?.message || ""}`); setPoBusy(false); return }
        // 商品行 + source_order_item_id
        const items = rows.map(r => ({
          purchase_order_id: po.id,
          product_id: r.product_id || null,
          product_name: r.product_name,
          quantity: r.quantity,
          unit_price: r.cost,
          source_order_item_id: r.item_id,
        }))
        const { error: ie } = await supabase.from("purchase_order_items").insert(items)
        if (ie) {
          // 明細失敗 → ヘッダもロールバック
          await supabase.from("purchase_orders").delete().eq("id", po.id)
          alert(`明細作成失敗: ${ie.message}\n\n発注書も取消しました。\n💡 RLS エラーの場合は db/migrations/2026-05-05_disable_rls_again.sql を Supabase Studio で実行してください。`)
          setPoBusy(false); return
        }
        // 元の order_items を発注済みに更新
        rows.forEach(r => allItemIdsToMark.push(r.item_id))
        created.push({ id: po.id, po_number: poNumber, supplier_name: supName })
      }
      // 一括で order_items を発注済みに
      if (allItemIdsToMark.length > 0) {
        const { error: ue } = await supabase.from("order_items").update({
          purchase_status: "発注済み",
          purchased_at: new Date().toISOString(),
        }).in("id", allItemIdsToMark)
        if (ue) { alert(`元注文の更新失敗: ${ue.message}`); setPoBusy(false); return }
      }
      setCreatedPOs(created)
      setSelectedIds(new Set())
      fetchData()
    } finally {
      setPoBusy(false)
    }
  }

  async function revertSelected() {
    if (selectedIds.size === 0) return
    if (!confirm(`${selectedIds.size}件を未発注に戻しますか？`)) return
    await supabase.from("order_items").update({
      purchase_status: "未発注",
      purchased_at: null,
    }).in("id", Array.from(selectedIds))
    setSelectedIds(new Set())
    fetchData()
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  // 印刷モード
  if (printMode) {
    const printRows = allRows.filter((r) => r.manufacturer === printMode && r.purchase_status === "未発注")
    const total = printRows.reduce((s, r) => s + r.cost * r.quantity, 0)
    return (
      <>
        <div className="no-print mb-4 flex items-center gap-2 sticky top-0 bg-white z-10 p-2 border border-gray-200 rounded">
          <button onClick={() => setPrintMode(null)} className="px-3 py-1.5 border border-gray-200 rounded text-xs">← 一覧に戻る</button>
          <button onClick={() => window.print()} className="px-4 py-1.5 bg-gray-900 text-white rounded text-xs font-bold">🖨 印刷</button>
          <span className="text-xs text-gray-500 ml-2">対象: <strong>{printMode}</strong> ({printRows.length}件)</span>
        </div>

        <div className="print-area bg-white p-8 max-w-3xl mx-auto" style={{ minHeight: "297mm", color: "#222", fontSize: 12 }}>
          <h1 className="text-3xl font-bold text-center my-6" style={{ letterSpacing: "0.3em" }}>商 品 発 注 書</h1>

          <div className="flex gap-6 mb-6">
            <div className="flex-1">
              <p className="text-xs">発注先</p>
              <p className="text-xl font-bold border-b-2 border-black pb-1">{printMode}　御中</p>
              <p className="text-xs mt-2">下記の通り、発注いたします。</p>
              <p className="text-xs mt-3">希望納期：＿＿＿年＿＿月＿＿日</p>
            </div>
            <div className="text-xs leading-6 relative" style={{ paddingRight: 70 }}>
              <p>発注年月日：{new Date().toLocaleDateString("ja-JP")}</p>
              <p className="font-bold text-sm mt-1">{COMPANY.name}</p>
              <p>〒{COMPANY.postalCode}</p>
              <p>{COMPANY.address}</p>
              <p>TEL：{COMPANY.phone}</p>
              <p>FAX：{COMPANY.fax}</p>
              <p>担当：</p>
              <div style={{ position: "absolute", top: 0, right: 0 }}><Seal size={56} /></div>
            </div>
          </div>

          <table className="w-full border-collapse" style={{ border: "2px solid #000" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ border: "1px solid #000", padding: "6px 4px", width: 40 }}>No</th>
                <th style={{ border: "1px solid #000", padding: "6px 4px" }}>商品名</th>
                <th style={{ border: "1px solid #000", padding: "6px 4px", width: 60 }}>数量</th>
                <th style={{ border: "1px solid #000", padding: "6px 4px", width: 50 }}>単位</th>
                <th style={{ border: "1px solid #000", padding: "6px 4px" }}>摘要</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 15 }).map((_, i) => {
                const r = printRows[i]
                return (
                  <tr key={i}>
                    <td className="text-center" style={{ border: "1px solid #000", padding: "4px", height: 22 }}>{i + 1}</td>
                    <td style={{ border: "1px solid #000", padding: "4px" }}>{r?.product_name || ""}</td>
                    <td className="text-center" style={{ border: "1px solid #000", padding: "4px" }}>{r?.quantity || ""}</td>
                    <td className="text-center" style={{ border: "1px solid #000", padding: "4px" }}>{r?.unit || ""}</td>
                    <td style={{ border: "1px solid #000", padding: "4px" }}>{r ? `${r.clinic_name} (${r.delivery_number})` : ""}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <style jsx global>{`
          @media print {
            .no-print { display: none !important; }
            nav { display: none !important; }
            body { background: white !important; }
            .print-area { padding: 12mm !important; }
          }
          @page { size: A4 portrait; margin: 0; }
        `}</style>
      </>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>
          発注管理
          <span className="ml-2 text-xs font-normal text-gray-400">該当 {filtered.length} ・ 未発注 {counts.unbought} ・ 発注済 {counts.bought}</span>
        </h1>
      </div>

      {/* フィルタ */}
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="商品・メーカー・医院・納品書で検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "unbought" | "bought" | "all")} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="unbought">未発注のみ ({counts.unbought})</option>
          <option value="bought">発注済みのみ ({counts.bought})</option>
          <option value="all">すべて ({counts.unbought + counts.bought})</option>
        </select>
        <select value={makerFilter} onChange={(e) => setMakerFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          {makers.map((m) => <option key={m} value={m}>{m === "all" ? "全メーカー" : m}</option>)}
        </select>
      </div>

      {/* バルクアクション */}
      <div className="flex gap-2 items-center text-xs">
        <button onClick={selectAll} className="px-3 py-1.5 border border-gray-200 rounded">全選択</button>
        <button onClick={clearSel} className="px-3 py-1.5 border border-gray-200 rounded text-gray-500">解除</button>
        <span className="text-gray-500">{selectedIds.size}件選択中</span>
        <div className="flex-1" />
        {statusFilter === "unbought" && (
          <button onClick={openCreatePOModal} disabled={selectedIds.size === 0} className="px-4 py-1.5 bg-emerald-600 text-white rounded font-bold disabled:opacity-40">
            ✉ 発注書を作成 ({selectedIds.size})
          </button>
        )}
        {statusFilter === "bought" && (
          <button onClick={revertSelected} disabled={selectedIds.size === 0} className="px-4 py-1.5 bg-gray-500 text-white rounded font-bold disabled:opacity-40">
            未発注に戻す ({selectedIds.size})
          </button>
        )}
        {makerFilter !== "all" && statusFilter === "unbought" && (
          <button onClick={() => setPrintMode(makerFilter)} className="px-4 py-1.5 bg-blue-600 text-white rounded font-bold">
            🖨 「{makerFilter}」発注書 印刷
          </button>
        )}
      </div>

      {/* テーブル */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 bg-gray-100">
            <tr style={{ fontSize: 12, fontWeight: 700 }} className="text-gray-700 border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-center w-8"><input type="checkbox" checked={filtered.length > 0 && selectedIds.size >= filtered.length} onChange={(e) => e.target.checked ? selectAll() : clearSel()} /></th>
              <th className="px-2 py-1.5 text-left">商品名</th>
              <th className="px-2 py-1.5 text-left w-32">メーカー</th>
              <th className="px-2 py-1.5 text-right w-12">数量</th>
              <th className="px-2 py-1.5 text-left w-32">注文医院</th>
              <th className="px-2 py-1.5 text-left w-28">納品書No</th>
              <th className="px-2 py-1.5 text-left w-20">注文日</th>
              <th className="px-2 py-1.5 text-center w-20">状態</th>
              <th className="px-2 py-1.5 text-left w-28">発注日</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">該当なし</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.item_id} className={"border-b border-gray-100 hover:bg-blue-50/30 " + (i % 2 === 0 ? "" : "bg-gray-50/30") + (selectedIds.has(r.item_id) ? " bg-blue-100" : "")}>
                <td className="px-2 py-1 text-center">
                  <input type="checkbox" checked={selectedIds.has(r.item_id)} onChange={() => toggleSelect(r.item_id)} />
                </td>
                <td className="px-2 py-1">{r.product_name}</td>
                <td className="px-2 py-1 text-gray-600">{r.manufacturer}</td>
                <td className="px-2 py-1 text-right font-bold">{r.quantity}{r.unit}</td>
                <td className="px-2 py-1 text-gray-700">{r.clinic_name}</td>
                <td className="px-2 py-1 font-mono text-gray-500" style={{ fontSize: 12 }}>{r.delivery_number}</td>
                <td className="px-2 py-1 text-gray-500" style={{ fontSize: 12 }}>{r.created_at ? new Date(r.created_at).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" }) : ""}</td>
                <td className="px-2 py-1 text-center">
                  {r.purchase_status === "発注済み" ? (
                    <span className="font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded" style={{ fontSize: 11 }}>発注済</span>
                  ) : (
                    <span className="font-bold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded" style={{ fontSize: 11 }}>未発注</span>
                  )}
                </td>
                <td className="px-2 py-1 text-gray-500" style={{ fontSize: 12 }}>{r.purchased_at ? new Date(r.purchased_at).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" }) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 発注書作成モーダル */}
      {showCreatePOModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !poBusy && setShowCreatePOModal(false)}>
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100">
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>発注書を作成</h2>
              <p className="text-xs text-gray-500 mt-1">
                メーカー別に発注書を分けます。各メーカーに対する仕入先を選択してください。
                発注書作成後、元注文は自動で「発注済み」に更新されます。
              </p>
            </div>
            <div className="p-4 space-y-3">
              {createdPOs.length > 0 ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                  <p className="text-sm font-bold text-emerald-900 mb-2">✅ {createdPOs.length}件の発注書を作成しました</p>
                  <ul className="space-y-1">
                    {createdPOs.map(po => (
                      <li key={po.id} className="flex items-center justify-between text-xs">
                        <span><strong>{po.po_number}</strong> ({po.supplier_name})</span>
                        <Link href={`/admin/purchase-orders/${po.id}`} className="text-blue-600 underline">開く</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  {selectedByMaker.map(([maker, rows]) => (
                    <div key={maker} className="border border-gray-200 rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontSize: 16, fontWeight: 700 }}>{maker}</span>
                        <span className="text-xs text-gray-500">{rows.length}行 / {fmtYen(rows.reduce((s, r) => s + r.cost * r.quantity, 0))}</span>
                      </div>
                      <select
                        value={makerToSupplier[maker] || ""}
                        onChange={e => setMakerToSupplier({ ...makerToSupplier, [maker]: e.target.value })}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm"
                      >
                        <option value="">仕入先を選択（未指定でも作成可）</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{supplierOptionLabel(s)}</option>)}
                      </select>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
              {createdPOs.length > 0 ? (
                <button onClick={() => setShowCreatePOModal(false)} className="px-4 py-2 bg-gray-900 text-white text-sm rounded">閉じる</button>
              ) : (
                <>
                  <button onClick={() => setShowCreatePOModal(false)} disabled={poBusy} className="px-4 py-2 text-gray-600 text-sm rounded">キャンセル</button>
                  <button onClick={createPOs} disabled={poBusy} className="px-5 py-2 bg-emerald-600 text-white text-sm font-bold rounded disabled:opacity-50">
                    {poBusy ? "作成中…" : `✓ ${selectedByMaker.length}件の発注書を作成`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* メーカー別サマリ */}
      <details className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <summary className="text-xs font-bold text-gray-500 cursor-pointer">メーカー別の未発注集計</summary>
        <div className="mt-2 space-y-1 max-h-64 overflow-auto">
          {Object.entries(allRows.filter((r) => r.purchase_status === "未発注").reduce((acc: Record<string, number>, r) => {
            acc[r.manufacturer] = (acc[r.manufacturer] || 0) + 1
            return acc
          }, {})).sort((a, b) => b[1] - a[1]).map(([maker, cnt]) => (
            <div key={maker} className="flex items-center justify-between py-1.5 px-2 border-b border-gray-100" style={{ fontSize: 12 }}>
              <span className="font-semibold">{maker}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">{cnt}件</span>
                <button onClick={() => { setMakerFilter(maker); setPrintMode(maker) }} className="px-2 py-1 bg-blue-100 text-blue-700 rounded" style={{ fontSize: 11 }}>発注書印刷</button>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
