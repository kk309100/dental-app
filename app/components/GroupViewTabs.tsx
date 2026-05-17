"use client"

import { useMemo, useState } from "react"
import { fmtYen } from "@/lib/invoice"

export type GroupViewKey = "list" | "by_date" | "by_party" | "by_product"

export type GroupableRow = {
  id: string
  date: string         // YYYY-MM-DD
  party: string        // 医院名 or 仕入先名
  amount: number       // 金額
  items?: { name: string; quantity: number; price: number }[]  // 明細（商品別集計用）
}

/**
 * 一覧表示の上に「📋 一覧 / 📅 日付別 / 🏥 得意先別 / 📦 商品別」のサブタブを表示
 * - list  : children をそのまま表示（各ページの既存テーブル）
 * - by_date  : 日付ごとに件数・金額集計
 * - by_party : 取引先ごとに件数・金額集計
 * - by_product : 商品ごとに販売数・金額集計
 *
 * ページ側で：
 *   const rows: GroupableRow[] = ...
 *   const view = useGroupView()
 *   <GroupViewTabs value={view} onChange={setView} rows={rows} partyLabel="医院">
 *     <YourExistingTable />
 *   </GroupViewTabs>
 */
export function useGroupView() {
  return useState<GroupViewKey>("list")
}

export function GroupViewTabs({
  value, onChange, rows, partyLabel = "得意先", children,
}: {
  value: GroupViewKey
  onChange: (v: GroupViewKey) => void
  rows: GroupableRow[]
  partyLabel?: string
  children: React.ReactNode
}) {
  return (
    <div>
      {/* タブ */}
      <div className="flex items-center gap-1 mb-2 text-xs">
        <Tab active={value === "list"} onClick={() => onChange("list")}>📋 一覧</Tab>
        <Tab active={value === "by_date"} onClick={() => onChange("by_date")}>📅 日付別</Tab>
        <Tab active={value === "by_party"} onClick={() => onChange("by_party")}>🏥 {partyLabel}別</Tab>
        <Tab active={value === "by_product"} onClick={() => onChange("by_product")}>📦 商品別</Tab>
      </div>

      {value === "list" && children}
      {value === "by_date" && <ByDate rows={rows} />}
      {value === "by_party" && <ByParty rows={rows} partyLabel={partyLabel} />}
      {value === "by_product" && <ByProduct rows={rows} />}
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={"px-3 py-1.5 rounded-t border-b-2 " +
        (active ? "border-emerald-500 text-gray-900 font-bold bg-white" : "border-transparent text-gray-500 hover:bg-gray-50")}>
      {children}
    </button>
  )
}

function ByDate({ rows }: { rows: GroupableRow[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, { date: string; count: number; amount: number }>()
    rows.forEach(r => {
      const day = (r.date || "").slice(0, 10)
      const e = m.get(day) || { date: day, count: 0, amount: 0 }
      e.count++; e.amount += Number(r.amount || 0)
      m.set(day, e)
    })
    return Array.from(m.values()).sort((a, b) => b.date.localeCompare(a.date))
  }, [rows])
  const total = groups.reduce((s, g) => s + g.amount, 0)
  return (
    <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
      <table className="w-full text-xs">
        <thead className="bg-gray-100 sticky top-0">
          <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
            <th className="px-3 py-1.5 text-left w-32">日付</th>
            <th className="px-3 py-1.5 text-right w-24">件数</th>
            <th className="px-3 py-1.5 text-right w-32">金額</th>
            <th className="px-3 py-1.5 text-right w-28">構成比</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.date} className="border-b border-gray-100 hover:bg-blue-50/40">
              <td className="px-3 py-1.5">{g.date}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{g.count}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-bold">{fmtYen(g.amount)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{total > 0 ? `${(g.amount / total * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 border-t-2 border-gray-300">
            <td className="px-3 py-2 font-bold">合計</td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">{rows.length}</td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">{fmtYen(total)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function ByParty({ rows, partyLabel }: { rows: GroupableRow[]; partyLabel: string }) {
  const groups = useMemo(() => {
    const m = new Map<string, { party: string; count: number; amount: number }>()
    rows.forEach(r => {
      const e = m.get(r.party) || { party: r.party, count: 0, amount: 0 }
      e.count++; e.amount += Number(r.amount || 0)
      m.set(r.party, e)
    })
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount)
  }, [rows])
  const total = groups.reduce((s, g) => s + g.amount, 0)
  return (
    <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
      <table className="w-full text-xs">
        <thead className="bg-gray-100 sticky top-0">
          <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
            <th className="px-3 py-1.5 text-left">{partyLabel}</th>
            <th className="px-3 py-1.5 text-right w-24">件数</th>
            <th className="px-3 py-1.5 text-right w-32">金額</th>
            <th className="px-3 py-1.5 text-right w-28">構成比</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.party} className="border-b border-gray-100 hover:bg-blue-50/40">
              <td className="px-3 py-1.5">{g.party}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{g.count}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-bold">{fmtYen(g.amount)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{total > 0 ? `${(g.amount / total * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 border-t-2 border-gray-300">
            <td className="px-3 py-2 font-bold">合計</td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">{rows.length}</td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">{fmtYen(total)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function ByProduct({ rows }: { rows: GroupableRow[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; amount: number; orderCount: number }>()
    rows.forEach(r => {
      (r.items || []).forEach(it => {
        const e = m.get(it.name) || { name: it.name, qty: 0, amount: 0, orderCount: 0 }
        e.qty += Number(it.quantity || 0)
        e.amount += Number(it.price || 0) * Number(it.quantity || 0)
        e.orderCount++
        m.set(it.name, e)
      })
    })
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount)
  }, [rows])
  const total = groups.reduce((s, g) => s + g.amount, 0)
  if (groups.length === 0) {
    return <p className="text-center text-gray-400 py-12 bg-white rounded border border-gray-200">商品明細なし</p>
  }
  return (
    <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
      <table className="w-full text-xs">
        <thead className="bg-gray-100 sticky top-0">
          <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
            <th className="px-3 py-1.5 text-left">商品名</th>
            <th className="px-3 py-1.5 text-right w-20">出現回数</th>
            <th className="px-3 py-1.5 text-right w-20">数量</th>
            <th className="px-3 py-1.5 text-right w-32">金額</th>
            <th className="px-3 py-1.5 text-right w-28">構成比</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.name} className="border-b border-gray-100 hover:bg-blue-50/40">
              <td className="px-3 py-1.5">{g.name}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{g.orderCount}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{g.qty}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-bold">{fmtYen(g.amount)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{total > 0 ? `${(g.amount / total * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 border-t-2 border-gray-300">
            <td className="px-3 py-2 font-bold">合計</td>
            <td></td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">{groups.reduce((s, g) => s + g.qty, 0)}</td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">{fmtYen(total)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
