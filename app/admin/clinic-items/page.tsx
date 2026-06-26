"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { parseCSV, toCSV, downloadCSV } from "@/lib/csv"

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

type Clinic = { id: string; name: string }

type ImportRow = {
  product_name: string; maker: string; barcode: string
  stock_quantity: number; min_stock: number | null
  location: string; shelf_no: string
}

const emptyAdd = { product_name: "", maker: "", barcode: "", stock_quantity: 0, min_stock: "", location: "", shelf_no: "" }

export default function ClinicItemsPage() {
  const [items, setItems]         = useState<ClinicItem[]>([])
  const [clinics, setClinics]     = useState<Clinic[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState("")
  const [clinicFilter, setClinicFilter] = useState("すべて")
  const [saving, setSaving]       = useState<string | null>(null)
  const [done, setDone]           = useState<Set<string>>(new Set())

  // 一括インポート
  const [importClinicId, setImportClinicId] = useState("")
  const [importRows, setImportRows]         = useState<ImportRow[]>([])
  const [importing, setImporting]           = useState(false)
  const [importMsg, setImportMsg]           = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  // 個別追加
  const [showAdd, setShowAdd]   = useState(false)
  const [addClinicId, setAddClinicId] = useState("")
  const [addForm, setAddForm]   = useState(emptyAdd)
  const [addSaving, setAddSaving] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [{ data: itemData }, { data: clinicData }] = await Promise.all([
      supabase.from("clinic_inventory_items")
        .select("id,product_name,maker,barcode,stock_quantity,min_stock,location,shelf_no,clinic_id,clinics(name)")
        .order("product_name"),
      supabase.from("clinics").select("id,name").order("name").limit(1000),
    ])
    if (itemData) setItems(itemData.map((d: any) => ({ ...d, clinic_name: d.clinics?.name ?? "（未設定）" })))
    if (clinicData) setClinics(clinicData as Clinic[])
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

  async function deleteItem(id: string) {
    if (!confirm("この商品を在庫リストから削除しますか？")) return
    await supabase.from("clinic_inventory_items").delete().eq("id", id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  // CSV読み込み
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseCSV(text)
      const mapped: ImportRow[] = rows
        .filter(r => r["商品名"]?.trim())
        .map(r => ({
          product_name:   r["商品名"]?.trim() || "",
          maker:          r["メーカー"]?.trim() || "",
          barcode:        r["バーコード"]?.trim() || "",
          stock_quantity: parseInt(r["初期在庫数"] || "0", 10) || 0,
          min_stock:      r["最低在庫数"] ? parseInt(r["最低在庫数"], 10) || null : null,
          location:       r["場所"]?.trim() || "",
          shelf_no:       r["棚番号"]?.trim() || "",
        }))
      setImportRows(mapped)
      setImportMsg("")
    }
    reader.readAsText(file, "UTF-8")
    e.target.value = ""
  }

  async function doImport() {
    if (!importClinicId) { setImportMsg("❌ 医院を選択してください"); return }
    if (importRows.length === 0) { setImportMsg("❌ CSVファイルを読み込んでください"); return }
    setImporting(true)
    const inserts = importRows.map(r => ({
      clinic_id:      importClinicId,
      product_name:   r.product_name,
      maker:          r.maker || null,
      barcode:        r.barcode || null,
      stock_quantity: r.stock_quantity,
      min_stock:      r.min_stock,
      location:       r.location || null,
      shelf_no:       r.shelf_no || null,
    }))
    const { error } = await supabase.from("clinic_inventory_items").insert(inserts)
    if (error) {
      setImportMsg(`❌ エラー: ${error.message}`)
    } else {
      setImportMsg(`✅ ${inserts.length}件を登録しました`)
      setImportRows([])
      await fetchData()
    }
    setImporting(false)
  }

  function downloadTemplate() {
    const template = [{ 商品名: "例）グローブM", メーカー: "ニチバン", バーコード: "", 初期在庫数: "5", 最低在庫数: "2", 場所: "処置室", 棚番号: "A-1" }]
    downloadCSV("在庫インポートテンプレート.csv", toCSV(template))
  }

  async function addItem() {
    if (!addClinicId) { alert("医院を選択してください"); return }
    if (!addForm.product_name.trim()) { alert("商品名を入力してください"); return }
    setAddSaving(true)
    const { error } = await supabase.from("clinic_inventory_items").insert({
      clinic_id:      addClinicId,
      product_name:   addForm.product_name.trim(),
      maker:          addForm.maker.trim() || null,
      barcode:        addForm.barcode.trim() || null,
      stock_quantity: Number(addForm.stock_quantity) || 0,
      min_stock:      addForm.min_stock !== "" ? (parseInt(addForm.min_stock as string, 10) || null) : null,
      location:       addForm.location.trim() || null,
      shelf_no:       addForm.shelf_no.trim() || null,
    })
    if (error) { alert("エラー: " + error.message) }
    else {
      setShowAdd(false)
      setAddForm(emptyAdd)
      await fetchData()
    }
    setAddSaving(false)
  }

  const clinicNames = useMemo(() => {
    const names = items.map((i) => i.clinic_name ?? "（未設定）")
    return ["すべて", ...Array.from(new Set(names)).sort()]
  }, [items])

  const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const filtered = useMemo(() => {
    const k = norm(search)
    return items.filter((i) => {
      const matchSearch = !k || norm(i.product_name).includes(k) || norm(i.maker || "").includes(k) || norm(i.location || "").includes(k)
      const matchClinic = clinicFilter === "すべて" || i.clinic_name === clinicFilter
      return matchSearch && matchClinic
    })
  }, [items, search, clinicFilter])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-gray-900">医院在庫アイテム管理</h1>
          <p className="text-xs text-gray-400 mt-0.5">医院スタッフの在庫画面に表示される商品の置き場所・最低在庫を設定します</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 rounded-lg text-sm font-bold text-white"
          style={{ background: "#059669" }}>
          ＋ 商品を個別追加
        </button>
      </div>

      {/* ── CSV一括インポート ── */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0" }}>
        <p className="text-sm font-bold text-green-800">📥 CSV一括インポート（初期セットアップ用）</p>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={importClinicId} onChange={e => setImportClinicId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white" style={{ minWidth: 180 }}>
            <option value="">医院を選択…</option>
            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={downloadTemplate}
            className="px-3 py-2 rounded-lg border text-sm"
            style={{ background: "#fff", borderColor: "#d1d5db", color: "#374151" }}>
            📋 テンプレートDL
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="px-3 py-2 rounded-lg text-sm font-bold"
            style={{ background: "#2563eb", color: "#fff", border: "none" }}>
            📂 CSVを選択
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
        </div>

        {importRows.length > 0 && (
          <div>
            <p className="text-xs text-green-700 mb-2">
              {importRows.length}件のデータを読み込みました。
              医院：<strong>{clinics.find(c => c.id === importClinicId)?.name || "（未選択）"}</strong>
            </p>
            <div className="overflow-auto max-h-48 rounded-lg border border-green-200 bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="px-2 py-1 text-left">商品名</th>
                    <th className="px-2 py-1 text-left">メーカー</th>
                    <th className="px-2 py-1 text-center">初期在庫</th>
                    <th className="px-2 py-1 text-center">最低在庫</th>
                    <th className="px-2 py-1 text-left">場所</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-2 py-1 font-medium">{r.product_name}</td>
                      <td className="px-2 py-1 text-gray-500">{r.maker || "-"}</td>
                      <td className="px-2 py-1 text-center">{r.stock_quantity}</td>
                      <td className="px-2 py-1 text-center">{r.min_stock ?? "-"}</td>
                      <td className="px-2 py-1 text-gray-500">{r.location || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button onClick={doImport} disabled={importing || !importClinicId}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white"
                style={{ background: importing || !importClinicId ? "#d1d5db" : "#059669", border: "none", cursor: importing || !importClinicId ? "default" : "pointer" }}>
                {importing ? "登録中…" : `✅ ${importRows.length}件を登録する`}
              </button>
              <button onClick={() => setImportRows([])} className="text-sm text-gray-400 underline">キャンセル</button>
            </div>
          </div>
        )}
        {importMsg && <p className="text-sm font-bold" style={{ color: importMsg.startsWith("✅") ? "#059669" : "#dc2626" }}>{importMsg}</p>}
        <p className="text-xs text-gray-500">
          CSVの列：<code className="bg-white px-1 rounded">商品名,メーカー,バーコード,初期在庫数,最低在庫数,場所,棚番号</code>
        </p>
      </div>

      {/* ── フィルター ── */}
      <div className="flex gap-2 flex-wrap items-center bg-gray-50 p-2 rounded-lg" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 商品名・メーカー・場所で検索"
          className="flex-1 min-w-[200px] px-3 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          {clinicNames.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-gray-400">{filtered.length} / {items.length} 件</span>
      </div>

      {/* ── テーブル ── */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 420px)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-3 py-2 text-left" style={td}>商品名</th>
              <th className="px-3 py-2 text-left w-24" style={td}>メーカー</th>
              <th className="px-3 py-2 text-left w-28" style={td}>医院</th>
              <th className="px-3 py-2 text-left w-36" style={td}>📍 置き場所</th>
              <th className="px-3 py-2 text-center w-20" style={td}>最低在庫</th>
              <th className="px-3 py-2 text-center w-16" style={td}>現在庫</th>
              <th className="px-3 py-2 text-center w-16" style={td}>状態</th>
              <th className="px-3 py-2 text-center w-12" style={td}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">該当アイテムなし</td></tr>
            ) : filtered.map((item, i) => {
              const low = item.min_stock !== null && item.stock_quantity <= item.min_stock
              const busy = saving === item.id
              const ok = done.has(item.id)
              return (
                <tr key={item.id}
                  className={"border-b border-gray-100 " + (i % 2 === 0 ? "" : "bg-gray-50/40") + (busy ? " opacity-50" : "")}>
                  <td className="px-3 py-1.5 font-medium text-[12px]" style={td}>{item.product_name}</td>
                  <td className="px-3 py-1.5 text-gray-500" style={td}>{item.maker || "-"}</td>
                  <td className="px-3 py-1.5 text-gray-500" style={td}>{item.clinic_name}</td>
                  <td className="px-2 py-1" style={td}>
                    <input
                      key={item.id + "-loc"}
                      defaultValue={item.location || ""}
                      placeholder="例）処置室・棚A"
                      onBlur={(e) => { if ((e.target.value.trim() || null) !== item.location) saveField(item.id, "location", e.target.value) }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-[12px] outline-none focus:border-green-400"
                      style={{ background: ok ? "#f0fdf4" : undefined }}
                    />
                  </td>
                  <td className="px-2 py-1 text-center" style={td}>
                    <input
                      type="number"
                      key={item.id + "-min"}
                      defaultValue={item.min_stock ?? ""}
                      placeholder="-"
                      onBlur={(e) => { const v = e.target.value.trim(); const cur = item.min_stock === null ? "" : String(item.min_stock); if (v !== cur) saveField(item.id, "min_stock", v) }}
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
                  <td className="px-2 py-1.5 text-center" style={td}>
                    <button onClick={() => deleteItem(item.id)}
                      className="text-[11px] text-red-400 hover:text-red-600 px-1"
                      title="削除">🗑</button>
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

      {/* ── 個別追加モーダル ── */}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800 }}>＋ 商品を個別追加</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280" }}>医院 <span style={{ color: "#ef4444" }}>*</span></label>
                <select value={addClinicId} onChange={e => setAddClinicId(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, marginTop: 4 }}>
                  <option value="">医院を選択…</option>
                  {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {[
                { key: "product_name", label: "商品名", required: true },
                { key: "maker", label: "メーカー" },
                { key: "barcode", label: "バーコード" },
                { key: "location", label: "置き場所" },
                { key: "shelf_no", label: "棚番号" },
              ].map(({ key, label, required }) => (
                <div key={key}>
                  <label style={{ fontSize: 12, color: "#6b7280" }}>{label} {required && <span style={{ color: "#ef4444" }}>*</span>}</label>
                  <input value={(addForm as any)[key]} onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, marginTop: 4, boxSizing: "border-box" }} />
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#6b7280" }}>初期在庫数</label>
                  <input type="number" min={0} value={addForm.stock_quantity}
                    onChange={e => setAddForm(f => ({ ...f, stock_quantity: Number(e.target.value) }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, marginTop: 4, boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#6b7280" }}>最低在庫数</label>
                  <input type="number" min={0} value={addForm.min_stock}
                    onChange={e => setAddForm(f => ({ ...f, min_stock: e.target.value }))}
                    placeholder="なし"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, marginTop: 4, boxSizing: "border-box" }} />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={addItem} disabled={addSaving}
                style={{ flex: 1, padding: "11px 0", borderRadius: 10, background: addSaving ? "#d1d5db" : "#059669", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: addSaving ? "default" : "pointer" }}>
                {addSaving ? "保存中…" : "追加する"}
              </button>
              <button onClick={() => { setShowAdd(false); setAddForm(emptyAdd) }}
                style={{ padding: "11px 20px", borderRadius: 10, background: "#f3f4f6", border: "none", color: "#374151", fontSize: 14, cursor: "pointer" }}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const td: React.CSSProperties = { borderRight: "1px solid #f0f0f0" }
