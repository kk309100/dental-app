"use client"

// 商品ごとの「仕入先別単価」「医院別単価」マトリクス表示・編集
// products 一覧から行展開で呼ばれる

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import {
  fetchSupplierPricesByProduct, fetchClinicPricesByProduct,
  upsertSupplierPrice, upsertClinicPrice, deleteSupplierPrice, deleteClinicPrice,
  type SupplierPrice, type ClinicPrice
} from "@/lib/pricing"

type Supplier = { id: string; name: string }
type Clinic = { id: string; name: string }

export default function ProductPriceMatrix({
  productId,
  productName,
  standardCost,
  standardPrice,
}: {
  productId: string
  productName: string
  standardCost: number | null
  standardPrice: number | null
}) {
  const [supPrices, setSupPrices] = useState<SupplierPrice[]>([])
  const [clinicPrices, setClinicPrices] = useState<ClinicPrice[]>([])
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([])
  const [allClinics, setAllClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)

  const [addSupplierId, setAddSupplierId] = useState("")
  const [addSupplierPrice, setAddSupplierPrice] = useState("")
  const [addClinicId, setAddClinicId] = useState("")
  const [addClinicPrice, setAddClinicPrice] = useState("")

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [sp, cp, sups, cls] = await Promise.all([
        fetchSupplierPricesByProduct(productId),
        fetchClinicPricesByProduct(productId),
        supabase.from("suppliers").select("id,name").order("name").limit(50000),
        supabase.from("clinics").select("id,name").order("name").limit(50000),
      ])
      setSupPrices(sp)
      setClinicPrices(cp)
      setAllSuppliers((sups.data as Supplier[]) || [])
      setAllClinics((cls.data as Clinic[]) || [])
      setLoading(false)
    })()
  }, [productId])

  async function refreshSup() {
    const sp = await fetchSupplierPricesByProduct(productId)
    setSupPrices(sp)
  }
  async function refreshCl() {
    const cp = await fetchClinicPricesByProduct(productId)
    setClinicPrices(cp)
  }

  // 仕入先別: 名前マップ + 最安検出
  const supplierNameMap = useMemo(() => new Map(allSuppliers.map(s => [s.id, s.name])), [allSuppliers])
  const clinicNameMap = useMemo(() => new Map(allClinics.map(c => [c.id, c.name])), [allClinics])

  const cheapestSupplier = useMemo(() => {
    if (supPrices.length === 0) return null
    return supPrices.reduce((min, p) => Number(p.unit_price) < Number(min.unit_price) ? p : min)
  }, [supPrices])

  // 医院別: 平均販売価格 + 粗利
  const clinicAvg = useMemo(() => {
    if (clinicPrices.length === 0) return null
    const sum = clinicPrices.reduce((s, p) => s + Number(p.unit_price), 0)
    return sum / clinicPrices.length
  }, [clinicPrices])

  const avgGross = useMemo(() => {
    if (clinicAvg === null || !standardCost) return null
    return clinicAvg - Number(standardCost)
  }, [clinicAvg, standardCost])

  async function handleUpdateSupplier(id: string, supplier_id: string, newPrice: number) {
    if (newPrice <= 0) return
    await upsertSupplierPrice({ supplier_id, product_id: productId, unit_price: newPrice })
    await refreshSup()
  }

  async function handleUpdateClinic(id: string, clinic_id: string, newPrice: number) {
    if (newPrice <= 0) return
    await upsertClinicPrice({ clinic_id, product_id: productId, unit_price: newPrice })
    await refreshCl()
  }

  async function handleAddSupplier() {
    const price = Number(addSupplierPrice)
    if (!addSupplierId || price <= 0) { alert("仕入先と単価を入力してください"); return }
    const r = await upsertSupplierPrice({ supplier_id: addSupplierId, product_id: productId, unit_price: price })
    if (!r.ok) { alert("追加失敗: " + r.error); return }
    setAddSupplierId(""); setAddSupplierPrice("")
    await refreshSup()
  }

  async function handleAddClinic() {
    const price = Number(addClinicPrice)
    if (!addClinicId || price <= 0) { alert("医院と単価を入力してください"); return }
    const r = await upsertClinicPrice({ clinic_id: addClinicId, product_id: productId, unit_price: price })
    if (!r.ok) { alert("追加失敗: " + r.error); return }
    setAddClinicId(""); setAddClinicPrice("")
    await refreshCl()
  }

  async function handleDeleteSupplier(id: string) {
    if (!confirm("この単価設定を削除しますか？")) return
    await deleteSupplierPrice(id)
    await refreshSup()
  }
  async function handleDeleteClinic(id: string) {
    if (!confirm("この単価設定を削除しますか？")) return
    await deleteClinicPrice(id)
    await refreshCl()
  }

  if (loading) return <div className="p-3 text-xs text-gray-400">読み込み中…</div>

  return (
    <div className="bg-blue-50/30 p-3 space-y-3" style={{ borderTop: "1px solid #e5e7eb" }}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 仕入先別単価 */}
        <div className="bg-white rounded-lg p-2.5" style={{ border: "1px solid #e5e7eb" }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-gray-700">📥 仕入先別仕入単価（税抜）</h3>
            <span className="text-[10px] text-gray-400">標準仕入: ¥{Number(standardCost || 0).toLocaleString()}</span>
          </div>
          {supPrices.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-2 text-center">登録なし（過去仕入履歴なし or マスタ未投入）</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-500 border-b border-gray-200">
                  <th className="text-left py-1">仕入先</th>
                  <th className="text-right py-1 w-24">単価</th>
                  <th className="text-left py-1 w-20">最終仕入</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {supPrices.map(p => {
                  const isCheapest = cheapestSupplier?.id === p.id
                  return (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="py-1 text-[11px]">
                      {isCheapest && <span title="最安" className="mr-1">🏆</span>}
                      {supplierNameMap.get(p.supplier_id) || "(削除済)"}
                    </td>
                    <td className="py-1 text-right">
                      <input type="number" defaultValue={p.unit_price}
                        onBlur={e => {
                          const v = Number(e.target.value)
                          if (v > 0 && v !== Number(p.unit_price)) handleUpdateSupplier(p.id, p.supplier_id, v)
                        }}
                        className="w-20 px-1 py-0.5 border border-gray-200 rounded text-[11px] text-right" />
                    </td>
                    <td className="py-1 text-[10px] text-gray-500">
                      {p.last_received_at ? new Date(p.last_received_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "—"}
                    </td>
                    <td className="py-1 text-center">
                      <button onClick={() => handleDeleteSupplier(p.id)} className="text-gray-300 hover:text-red-500 text-sm">×</button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="flex gap-1 mt-2 pt-2 border-t border-gray-100">
            <select value={addSupplierId} onChange={e => setAddSupplierId(e.target.value)}
              className="flex-1 px-1.5 py-1 border border-gray-200 rounded text-[11px]">
              <option value="">— 仕入先を追加 —</option>
              {allSuppliers
                .filter(s => !supPrices.some(p => p.supplier_id === s.id))
                .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="number" value={addSupplierPrice} onChange={e => setAddSupplierPrice(e.target.value)}
              placeholder="¥" className="w-20 px-1.5 py-1 border border-gray-200 rounded text-[11px] text-right" />
            <button onClick={handleAddSupplier} disabled={!addSupplierId || !addSupplierPrice}
              className="px-2 py-1 bg-blue-600 text-white text-[11px] rounded hover:bg-blue-700 disabled:opacity-30">
              追加
            </button>
          </div>
        </div>

        {/* 医院別単価 */}
        <div className="bg-white rounded-lg p-2.5" style={{ border: "1px solid #e5e7eb" }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-gray-700">📤 医院別販売単価（税抜）</h3>
            <span className="text-[10px] text-gray-400">標準定価: ¥{Number(standardPrice || 0).toLocaleString()}</span>
          </div>
          {clinicPrices.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-2 text-center">登録なし（過去販売履歴なし or マスタ未投入）</p>
          ) : (
            <>
              {clinicAvg !== null && (
                <p className="text-[10px] text-gray-500 mb-1">
                  💰 平均販売: ¥{Math.round(clinicAvg).toLocaleString()}
                  {avgGross !== null && (
                    <span className={"ml-2 " + (avgGross >= 0 ? "text-emerald-600" : "text-red-600")}>
                      粗利 ¥{Math.round(avgGross).toLocaleString()}（{standardCost ? Math.round(avgGross / Number(standardCost) * 100) : "?"}%）
                    </span>
                  )}
                </p>
              )}
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-500 border-b border-gray-200">
                    <th className="text-left py-1">医院</th>
                    <th className="text-right py-1 w-24">単価</th>
                    <th className="text-left py-1 w-20">最終販売</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {clinicPrices.map(p => (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="py-1 text-[11px]">
                        {clinicNameMap.get(p.clinic_id) || "(削除済)"}
                      </td>
                      <td className="py-1 text-right">
                        <input type="number" defaultValue={p.unit_price}
                          onBlur={e => {
                            const v = Number(e.target.value)
                            if (v > 0 && v !== Number(p.unit_price)) handleUpdateClinic(p.id, p.clinic_id, v)
                          }}
                          className="w-20 px-1 py-0.5 border border-gray-200 rounded text-[11px] text-right" />
                      </td>
                      <td className="py-1 text-[10px] text-gray-500">
                        {p.last_sold_at ? new Date(p.last_sold_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "—"}
                      </td>
                      <td className="py-1 text-center">
                        <button onClick={() => handleDeleteClinic(p.id)} className="text-gray-300 hover:text-red-500 text-sm">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="flex gap-1 mt-2 pt-2 border-t border-gray-100">
            <select value={addClinicId} onChange={e => setAddClinicId(e.target.value)}
              className="flex-1 px-1.5 py-1 border border-gray-200 rounded text-[11px]">
              <option value="">— 医院を追加 —</option>
              {allClinics
                .filter(c => !clinicPrices.some(p => p.clinic_id === c.id))
                .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="number" value={addClinicPrice} onChange={e => setAddClinicPrice(e.target.value)}
              placeholder="¥" className="w-20 px-1.5 py-1 border border-gray-200 rounded text-[11px] text-right" />
            <button onClick={handleAddClinic} disabled={!addClinicId || !addClinicPrice}
              className="px-2 py-1 bg-emerald-600 text-white text-[11px] rounded hover:bg-emerald-700 disabled:opacity-30">
              追加
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
