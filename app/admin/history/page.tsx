"use client"

// 過去実績（読み取り専用）: 前システムの商品元帳（売上・仕入）を、医院別・商品別に見る。
// データは history_lines（今の注文・請求・売上集計とは別）。何も書き換えない。

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase, fetchAll } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Clinic = { id: string; name: string }
type Line = {
  id: number; slip_date: string; slip_no: string | null; kind: string
  partner_name: string | null; product_id: string | null; item_code: string | null; item_name: string | null
  unit_price: number | null; quantity: number | null; amount: number | null; memo: string | null
}
type Mode = "lines" | "products"

const PAGE = 100
const norm = (v: string) => String(v || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")
const today = () => new Date().toISOString().slice(0, 10)
const yearsAgo = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10) }

export default function HistoryPage() {
  const router = useRouter()
  const [picked, setPicked] = useState<Record<string, number>>({})   // 注文に入れる商品ID → 数量
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [clinicId, setClinicId] = useState("")
  const [clinicSearch, setClinicSearch] = useState("")
  const [partnerText, setPartnerText] = useState("")          // 前システムの取引先名で検索（DentHubの医院と未照合のもの用）
  const [kind, setKind] = useState("売上")
  const [from, setFrom] = useState(yearsAgo(1))
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState<Line[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<Mode>("products")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  useEffect(() => {
    fetchAll("clinics", "id,name", (q: any) => q.order("id")).then((c: Clinic[]) =>
      setClinics(c.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"))))
  }, [])

  const clinicOptions = useMemo(() => {
    const k = norm(clinicSearch)
    return clinics.filter(c => !k || norm(c.name).includes(k))
  }, [clinics, clinicSearch])

  async function load() {
    if (!clinicId && !partnerText.trim()) { alert("医院を選ぶか、取引先名を入力してください"); return }
    setLoading(true); setLoaded(false); setPage(1); setPicked({})
    const data = await fetchAll(
      "history_lines",
      "id,slip_date,slip_no,kind,partner_name,product_id,item_code,item_name,unit_price,quantity,amount,memo",
      (q: any) => {
        let b = q.gte("slip_date", from).lte("slip_date", to)
        if (kind !== "すべて") b = b.eq("kind", kind)
        if (clinicId) b = b.eq(kind === "仕入" ? "supplier_id" : "clinic_id", clinicId)
        else b = b.ilike("partner_name", `%${partnerText.trim().replace(/[%,]/g, " ")}%`)
        return b.order("slip_date", { ascending: false }).order("id", { ascending: false })
      },
    )
    setRows(data as Line[])
    setLoaded(true); setLoading(false)
  }

  const filtered = useMemo(() => {
    const k = norm(search)
    return k ? rows.filter(r => norm(`${r.item_name || ""} ${r.item_code || ""}`).includes(k)) : rows
  }, [rows, search])

  // 商品別まとめ: 最終購入日・最終単価・回数・合計数量・合計金額
  const products = useMemo(() => {
    const m = new Map<string, { pid: string | null; name: string; code: string; last: string; lastPrice: number | null; count: number; qty: number; amount: number }>()
    for (const r of filtered) {
      const key = r.item_code || r.item_name || "?"
      const e = m.get(key)
      if (!e) {
        m.set(key, { pid: r.product_id, name: r.item_name || "", code: r.item_code || "", last: r.slip_date, lastPrice: r.unit_price, count: 1, qty: Number(r.quantity || 0), amount: Number(r.amount || 0) })
      } else {
        e.count++; e.qty += Number(r.quantity || 0); e.amount += Number(r.amount || 0)
        if (r.slip_date > e.last) { e.last = r.slip_date; e.lastPrice = r.unit_price }   // 行は日付降順なので通常は最初の行が最新
      }
    }
    return Array.from(m.values()).sort((a, b) => b.last.localeCompare(a.last) || b.amount - a.amount)
  }, [filtered])

  const pickedCount = Object.keys(picked).length
  const prodByPid = useMemo(() => new Map(products.filter(p => p.pid).map(p => [p.pid as string, p])), [products])
  function startOrder() {
    if (!clinicId) return
    const items = Object.entries(picked).map(([pid, q]) => `${pid}:${q}:${prodByPid.get(pid)?.lastPrice ?? ""}`).join(";")
    router.push(`/admin/orders/new?clinic=${clinicId}&items=${encodeURIComponent(items)}`)
  }

  const list = mode === "lines" ? filtered : products
  const pageItems = list.slice((page - 1) * PAGE, page * PAGE)
  const maxPage = Math.max(1, Math.ceil(list.length / PAGE))
  const total = filtered.reduce((s, r) => s + Number(r.amount || 0), 0)

  const inp = "px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
  const th = "px-2 py-1.5 text-left text-[12px] font-bold text-gray-700 border-b-2 border-gray-300 bg-gray-100 sticky top-0"

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold">📚 過去実績（前システム）</h1>
        <p className="text-xs text-gray-500">前システムの商品元帳（2016年9月〜2026年9月30日）を、医院別・商品別に見られます。見るだけの画面で、今の注文・請求には影響しません。</p>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input value={clinicSearch} onChange={e => setClinicSearch(e.target.value)} placeholder="医院名で絞り込み" className={inp + " w-44"} />
          <select value={clinicId} onChange={e => { setClinicId(e.target.value); if (e.target.value) setPartnerText("") }} className={inp + " min-w-[220px] max-w-[320px]"}>
            <option value="">（医院を選ぶ）</option>
            {clinicOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="text-xs text-gray-400">または</span>
          <input value={partnerText} onChange={e => { setPartnerText(e.target.value); if (e.target.value) setClinicId("") }}
            placeholder="前システムの取引先名で検索" className={inp + " w-56"} />
        </div>
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <select value={kind} onChange={e => setKind(e.target.value)} className={inp}>
            <option>売上</option><option>仕入</option><option>戻入</option><option>値引</option><option>すべて</option>
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} />
          <span>〜</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} />
          <button onClick={() => { setFrom("2016-01-01"); setTo(today()) }} className="text-xs underline text-blue-700">全期間</button>
          <button onClick={() => { setFrom(yearsAgo(1)); setTo(today()) }} className="text-xs underline text-blue-700">直近1年</button>
          <button onClick={load} disabled={loading} className="px-4 py-1.5 rounded bg-blue-600 text-white text-sm font-bold disabled:opacity-50">
            {loading ? "読み込み中…" : "表示"}
          </button>
        </div>
        <p className="text-[11px] text-gray-400">※「仕入」は、医院ではなく仕入先で絞り込みます（医院の欄に、仕入先が出ます）。仕入先の履歴は、取引先名の検索でも探せます。</p>
      </div>

      {loaded && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="inline-flex rounded border border-gray-300 overflow-hidden text-xs">
              <button onClick={() => { setMode("products"); setPage(1) }} className={"px-3 py-1.5 " + (mode === "products" ? "bg-blue-600 text-white" : "bg-white")}>商品別まとめ</button>
              <button onClick={() => { setMode("lines"); setPage(1) }} className={"px-3 py-1.5 " + (mode === "lines" ? "bg-blue-600 text-white" : "bg-white")}>明細（日付順）</button>
            </div>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="商品名・コードで絞り込み" className={inp + " w-56"} />
            <span className="text-xs text-gray-600">{filtered.length.toLocaleString()}行 ／ 商品 {products.length.toLocaleString()}種類 ／ 合計 {fmtYen(total)}</span>
          </div>

          {mode === "products" && clinicId && kind === "売上" && (
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded bg-emerald-50 text-sm" style={{ border: "1px solid #a7f3d0" }}>
              <span className="text-xs text-gray-600">注文する商品にチェックを入れてください（DentHubの商品と照合できているものだけ選べます）</span>
              <span className="font-bold text-emerald-700">{pickedCount} 商品選択中</span>
              <button onClick={startOrder} disabled={pickedCount === 0}
                className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-bold disabled:opacity-40">🛒 選んだ商品で注文を作成</button>
              {pickedCount > 0 && <button onClick={() => setPicked({})} className="text-xs underline text-gray-600">選択を解除</button>}
            </div>
          )}

          <div className="bg-white border border-gray-300 rounded overflow-auto" style={{ maxHeight: "calc(100vh - 340px)" }}>
            {list.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">該当する履歴がありません（期間や区分を変えてみてください）</div>
            ) : mode === "products" ? (
              <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
                <thead><tr>
                  {clinicId && kind === "売上" && <th className={th + " w-28"}>注文</th>}
                  <th className={th}>商品名</th><th className={th + " w-32"}>コード</th><th className={th + " w-24"}>最終日</th>
                  <th className={th + " w-20 text-right"}>最終単価</th><th className={th + " w-14 text-right"}>回数</th>
                  <th className={th + " w-16 text-right"}>数量計</th><th className={th + " w-24 text-right"}>金額計</th>
                </tr></thead>
                <tbody>
                  {(pageItems as typeof products).map((p, i) => (
                    <tr key={p.code + p.name + i} className="border-b border-gray-100 hover:bg-blue-50/40">
                      {clinicId && kind === "売上" && (
                        <td className="px-2 py-1">
                          {p.pid ? (
                            <span className="inline-flex items-center gap-1">
                              <input type="checkbox" checked={p.pid in picked}
                                onChange={e => setPicked(prev => { const n = { ...prev }; if (e.target.checked) n[p.pid as string] = 1; else delete n[p.pid as string]; return n })} />
                              {p.pid in picked && (
                                <input type="number" min={1} value={picked[p.pid]}
                                  onChange={e => setPicked(prev => ({ ...prev, [p.pid as string]: Math.max(1, Number(e.target.value) || 1) }))}
                                  className="w-14 px-1 py-0.5 border border-gray-300 rounded text-right" />
                              )}
                            </span>
                          ) : <span className="text-gray-300" title="DentHubの商品と照合できていません">—</span>}
                        </td>
                      )}
                      <td className="px-2 py-1">{p.name}</td>
                      <td className="px-2 py-1 font-mono text-gray-500">{p.code}</td>
                      <td className="px-2 py-1">{p.last}</td>
                      <td className="px-2 py-1 text-right">{p.lastPrice != null ? fmtYen(p.lastPrice) : ""}</td>
                      <td className="px-2 py-1 text-right">{p.count}</td>
                      <td className="px-2 py-1 text-right">{p.qty}</td>
                      <td className="px-2 py-1 text-right">{fmtYen(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
                <thead><tr>
                  <th className={th + " w-24"}>日付</th><th className={th + " w-20"}>伝票NO</th><th className={th + " w-12"}>区分</th>
                  {!clinicId && <th className={th + " w-48"}>取引先</th>}
                  <th className={th}>商品名</th><th className={th + " w-20 text-right"}>単価</th>
                  <th className={th + " w-12 text-right"}>数量</th><th className={th + " w-24 text-right"}>金額</th><th className={th + " w-32"}>摘要</th>
                </tr></thead>
                <tbody>
                  {(pageItems as Line[]).map(r => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-blue-50/40">
                      <td className="px-2 py-1">{r.slip_date}</td>
                      <td className="px-2 py-1 font-mono text-gray-500">{r.slip_no}</td>
                      <td className="px-2 py-1">{r.kind}</td>
                      {!clinicId && <td className="px-2 py-1 text-gray-600">{r.partner_name}</td>}
                      <td className="px-2 py-1">{r.item_name}</td>
                      <td className="px-2 py-1 text-right">{r.unit_price != null ? fmtYen(r.unit_price) : ""}</td>
                      <td className="px-2 py-1 text-right">{r.quantity}</td>
                      <td className="px-2 py-1 text-right">{r.amount != null ? fmtYen(r.amount) : ""}</td>
                      <td className="px-2 py-1 text-gray-500">{r.memo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {maxPage > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 border rounded disabled:opacity-40">前へ</button>
              <span>{page} / {maxPage}</span>
              <button onClick={() => setPage(p => Math.min(maxPage, p + 1))} disabled={page >= maxPage} className="px-3 py-1 border rounded disabled:opacity-40">次へ</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
