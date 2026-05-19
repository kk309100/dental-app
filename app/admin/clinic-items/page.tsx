"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"

type ClinicItem = {
  id: string
  product_name: string
  maker: string | null
  barcode: string | null
  stock_quantity: number
  min_stock: number | null
  location: string | null
  shelf_no: string | null
  clinic_id: string | null
  clinic_name?: string
}

export default function ClinicItemsPage() {
  const [items, setItems]       = useState<ClinicItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState("")
  const [clinicFilter, setClinicFilter] = useState("すべて")
  const [saving, setSaving]     = useState<string | null>(null)
  const [done, setDone]         = useState<Set<string>>(new Set())

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from("clinic_inventory_items")
      .select("id,product_name,maker,barcode,stock_quantity,min_stock,location,shelf_no,clinic_id,clinics(name)")
      .order("product_name")
    if (!data) { setLoading(false); return }
    setItems(data.map((d: any) => ({ ...d, clinic_name: d.clinics?.name ?? "（未設定）" })))
    setLoading(false)
  }

  async function saveField(id: string, field: "location" | "min_stock", value: string) {
    setSaving(id)
    const update: Record<string, any> = {}
    if (field === "location") {
      update.location = value.trim() || null
    } else {
      const n = parseInt(value, 10)
      update.min_stock = isNaN(n) ? null : n
    }
    await supabase.from("clinic_inventory_items").update(update).eq("id", id)
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...update } : i))
    setDone((prev) => { const s = new Set(prev); s.add(id); return s })
    setTimeout(() => setDone((prev) => { const s = new Set(prev); s.delete(id); return s }), 1500)
    setSaving(null)
  }

  const clinics = useMemo(() => {
    const names = items.map((i) => i.clinic_name ?? "（未設定）")
    return ["すべて", ...Array.from(new Set(names)).sort()]
  }, [items])

  const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const filtered = useMemo(() => {
    const k = norm(search)
    return items.filter((i) => {
      const matchSearch = !k ||
        norm(i.product_name).includes(k) ||
        norm(i.maker || "").includes(k) ||
        norm(i.location || "").includes(k)
      const matchClinic = clinicFilter === "すべて" || i.clinic_name === clinicFilter
      return matchSearch && matchClinic
    })
  }, [items, search, clinicFilter])

  // 場所ごとにグループ化して一覧表示するためのユニーク場所リスト
  const locationList = useMemo(() => {
    const locs = filtered.map((i) => i.location || "").filter(Boolean)
    return Array.from(new Set(locs)).sort()
  }, [filtered])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-gray-900">医院在庫アイテム管理</h1>
          <p className="text-xs text-gray-400 mt-0.5">医院スタッフの在庫画面に表示される商品の置き場所・最低在庫を設定します</p>
        </div>
        <span className="text-xs text-gray-400">{filtered.length} / {items.length} 件</span>
      </div>

      {/* フィルター */}
      <div className="flex gap-2 flex-wrap items-center bg-gray-50 p-2 rounded-lg" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 商品名・メーカー・場所で検索"
          className="flex-1 min-w-[200px] px-3 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        {clinics.length > 2 && (
          <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
            {clinics.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* 場所サマリー */}
      {locationList.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {locationList.map((loc) => (
            <span key={loc} onClick={() => setSearch(loc)}
              className="text-xs px-2.5 py-1 rounded-full cursor-pointer"
              style={{ background: "#e8f5ec", color: "#166534", border: "1px solid #bbf7d0" }}>
              📍 {loc} ({filtered.filter((i) => i.location === loc).length})
            </span>
          ))}
        </div>
      )}

      {/* テーブル */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 260px)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-3 py-2 text-left" style={td}>商品名</th>
              <th className="px-3 py-2 text-left w-24" style={td}>メーカー</th>
              {clinicFilter === "すべて" && <th className="px-3 py-2 text-left w-28" style={td}>医院</th>}
              <th className="px-3 py-2 text-left w-36" style={td}>📍 置き場所</th>
              <th className="px-3 py-2 text-center w-20" style={td}>最低在庫</th>
              <th className="px-3 py-2 text-center w-16" style={td}>現在庫</th>
              <th className="px-3 py-2 text-center w-16" style={td}>状態</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">該当アイテムなし</td></tr>
            ) : filtered.map((item, i) => {
              const low = item.min_stock !== null && item.stock_quantity <= item.min_stock
              const busy = saving === item.id
              const ok = done.has(item.id)
              return (
                <tr key={item.id}
                  className={"border-b border-gray-100 " + (i % 2 === 0 ? "" : "bg-gray-50/40") + (busy ? " opacity-50" : "")}>
                  <td className="px-3 py-1.5 font-medium text-[12px]" style={td}>{item.product_name}</td>
                  <td className="px-3 py-1.5 text-gray-500" style={td}>{item.maker || "-"}</td>
                  {clinicFilter === "すべて" && (
                    <td className="px-3 py-1.5 text-gray-500" style={td}>{item.clinic_name}</td>
                  )}
                  {/* 置き場所 */}
                  <td className="px-2 py-1" style={td}>
                    <input
                      key={item.id + "-loc"}
                      defaultValue={item.location || ""}
                      placeholder="例）処置室・棚A"
                      onBlur={(e) => {
                        if ((e.target.value.trim() || null) !== item.location)
                          saveField(item.id, "location", e.target.value)
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-[12px] outline-none focus:border-green-400"
                      style={{ background: ok ? "#f0fdf4" : undefined }}
                    />
                  </td>
                  {/* 最低在庫 */}
                  <td className="px-2 py-1 text-center" style={td}>
                    <input
                      type="number"
                      key={item.id + "-min"}
                      defaultValue={item.min_stock ?? ""}
                      placeholder="-"
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        const current = item.min_stock === null ? "" : String(item.min_stock)
                        if (v !== current) saveField(item.id, "min_stock", v)
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                      className="w-14 px-1 py-1 border border-gray-200 rounded text-center text-[12px] outline-none focus:border-blue-400"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-center font-bold text-[13px]"
                    style={{ ...td, color: low ? "#ef4444" : "#22a648" }}>
                    {item.stock_quantity}
                  </td>
                  <td className="px-2 py-1.5 text-center" style={td}>
                    {low
                      ? <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">発注必要</span>
                      : <span className="text-[10px] text-green-700">OK</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 px-1">
        ※ 置き場所・最低在庫はフォーカスを外したとき（Enterキーまたはクリック移動）に自動保存されます
      </p>
    </div>
  )
}

const td: React.CSSProperties = { borderRight: "1px solid #f0f0f0" }
