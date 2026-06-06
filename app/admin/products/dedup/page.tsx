"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

type Product = {
  id: string
  name: string
  product_code: string | null
  manufacturer: string | null
  category: string | null
  price: number | null
  cost: number | null
  active: boolean | null
  image_url: string | null
}

type DupGroup = {
  name: string
  keep: Product    // 品番あり → 残す
  remove: Product  // 品番なし → 削除
}

type SingleGroup = {
  name: string
  rows: Product[]
}

export default function DedupPage() {
  const [loading, setLoading]       = useState(true)
  const [dupGroups, setDupGroups]   = useState<DupGroup[]>([])
  const [oddGroups, setOddGroups]   = useState<SingleGroup[]>([])   // 3件以上など
  const [noCodeCount, setNoCodeCount] = useState(0)
  const [fixing, setFixing]         = useState(false)
  const [fixLog, setFixLog]         = useState<string[]>([])
  const [done, setDone]             = useState(false)
  const [deleteIds, setDeleteIds]   = useState<Set<string>>(new Set())

  useEffect(() => { analyze() }, [])

  async function analyze() {
    setLoading(true)
    setDone(false)
    setFixLog([])

    // 全商品取得
    let all: Product[] = []
    let from = 0
    while (true) {
      const { data } = await supabase
        .from("products")
        .select("id,name,product_code,manufacturer,category,price,cost,active,image_url")
        .range(from, from + 999)
        .order("name")
      if (!data || data.length === 0) break
      all = all.concat(data as Product[])
      if (data.length < 1000) break
      from += 1000
    }

    // 品番なし件数
    setNoCodeCount(all.filter(p => !p.product_code).length)

    // 商品名でグルーピング
    const map: Record<string, Product[]> = {}
    for (const p of all) {
      if (!p.name) continue
      if (!map[p.name]) map[p.name] = []
      map[p.name].push(p)
    }

    const dupes: DupGroup[]   = []
    const odds: SingleGroup[] = []

    // 数字を含むコードを「品番あり」として優先
    const hasNumericCode = (r: Product) => /\d/.test(r.product_code || "")

    for (const [name, rows] of Object.entries(map)) {
      if (rows.length < 2) continue
      const withNum = rows.filter(hasNumericCode)
      const noNum   = rows.filter(r => !hasNumericCode(r))

      if (withNum.length === 1 && noNum.length === 1) {
        dupes.push({ name, keep: withNum[0], remove: noNum[0] })
      } else {
        // 数字ありが複数 or 全員なし → 要確認
        odds.push({ name, rows })
      }
    }

    setDupGroups(dupes)
    setOddGroups(odds)
    // デフォルトで削除候補をセット
    setDeleteIds(new Set(dupes.map(g => g.remove.id)))
    setLoading(false)
  }

  function toggleDelete(id: string) {
    setDeleteIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runFix() {
    if (!window.confirm(`${deleteIds.size}件の重複商品を削除します。よろしいですか？`)) return
    setFixing(true)
    setFixLog([])

    try {
      const res = await fetch("/api/admin/products/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(deleteIds) }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFixLog([`❌ APIエラー: ${json.error ?? res.statusText}`])
      } else {
        if (json.errors?.length > 0) {
          json.errors.forEach((e: string) => setFixLog(l => [...l, `❌ ${e}`]))
        }
        setFixLog(l => [...l, ``, `✅ 完了: ${json.deleted}件削除 / ${json.failed}件エラー`])
      }
    } catch (e: any) {
      setFixLog([`❌ 通信エラー: ${e.message}`])
    }

    setFixing(false)
    setDone(true)
    await analyze()
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>
        重複を解析中…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: "bold", color: "#111", marginBottom: 4 }}>
          🔍 商品データ 重複管理
        </h1>
        <p style={{ fontSize: 13, color: "#6b7280" }}>
          同一商品名のレコードを検出し、重複を解消します。
        </p>
      </div>

      {/* サマリーカード */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          { label: "重複グループ",    val: dupGroups.length,  color: dupGroups.length > 0 ? "#dc2626" : "#059669", bg: dupGroups.length > 0 ? "#fef2f2" : "#f0fdf4", border: dupGroups.length > 0 ? "#fecaca" : "#bbf7d0" },
          { label: "削除候補（品番なし）", val: deleteIds.size,    color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
          { label: "品番なし商品（全体）", val: noCodeCount,        color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
          { label: "要確認（3件以上）",  val: oddGroups.length,  color: oddGroups.length > 0 ? "#7c3aed" : "#059669", bg: oddGroups.length > 0 ? "#f5f3ff" : "#f0fdf4", border: oddGroups.length > 0 ? "#ddd6fe" : "#bbf7d0" },
        ].map(s => (
          <div key={s.label} style={{ flex: "1 1 160px", background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ fontSize: 26, fontWeight: "bold", color: s.color }}>{s.val.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* 完了メッセージ */}
      {done && dupGroups.length === 0 && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "14px 18px", marginBottom: 20, color: "#166534", fontWeight: "bold", fontSize: 15 }}>
          🎉 重複はすべて解消されました！
        </div>
      )}

      {/* 修正ログ */}
      {fixLog.length > 0 && (
        <div style={{ background: "#111", borderRadius: 10, padding: "12px 14px", marginBottom: 20, fontFamily: "monospace", fontSize: 12, maxHeight: 160, overflowY: "auto" }}>
          {fixLog.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("❌") ? "#fca5a5" : l.startsWith("✅") ? "#86efac" : "#d1fae5", marginBottom: 2 }}>{l || " "}</div>
          ))}
        </div>
      )}

      {/* ── 重複グループ一覧 ── */}
      {dupGroups.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: "bold", color: "#111" }}>
              ⚠️ 重複商品（{dupGroups.length}グループ）
            </h2>
            <button
              onClick={runFix}
              disabled={fixing || deleteIds.size === 0}
              style={{
                padding: "9px 22px", borderRadius: 8, border: "none",
                background: fixing || deleteIds.size === 0 ? "#d1d5db" : "#dc2626",
                color: "#fff", fontWeight: "bold", fontSize: 14,
                cursor: fixing || deleteIds.size === 0 ? "not-allowed" : "pointer",
              }}
            >
              {fixing ? "削除中…" : `🗑 チェックした${deleteIds.size}件を削除`}
            </button>
          </div>

          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>
            ✅ = 残す（品番あり）　　🗑 = 削除（品番なし）— チェックを外すと削除しません
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dupGroups.map((g, i) => (
              <div key={g.name} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
                {/* グループヘッダー */}
                <div style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb", padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "#374151" }}>
                  #{i + 1} &nbsp;{g.name}
                </div>

                {/* 残すレコード */}
                <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 12, borderBottom: "1px solid #f3f4f6" }}>
                  <span style={{ fontSize: 18 }}>✅</span>
                  <div style={{ flex: 1, fontSize: 13 }}>
                    <span style={{ background: "#dcfce7", color: "#166534", padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, marginRight: 8 }}>残す</span>
                    品番: <strong>{g.keep.product_code}</strong>
                    <span style={{ color: "#9ca3af", marginLeft: 12 }}>¥{g.keep.price?.toLocaleString() ?? "—"}</span>
                    <span style={{ color: "#9ca3af", marginLeft: 12 }}>ID: {g.keep.id.slice(0, 8)}…</span>
                  </div>
                </div>

                {/* 削除レコード */}
                <div style={{
                  display: "flex", alignItems: "center", padding: "10px 16px", gap: 12,
                  background: deleteIds.has(g.remove.id) ? "#fff5f5" : "#fff",
                }}>
                  <input
                    type="checkbox"
                    checked={deleteIds.has(g.remove.id)}
                    onChange={() => toggleDelete(g.remove.id)}
                    style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#dc2626" }}
                  />
                  <div style={{ flex: 1, fontSize: 13 }}>
                    <span style={{ background: deleteIds.has(g.remove.id) ? "#fee2e2" : "#f3f4f6", color: deleteIds.has(g.remove.id) ? "#b91c1c" : "#6b7280", padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, marginRight: 8 }}>
                      {deleteIds.has(g.remove.id) ? "削除" : "保留"}
                    </span>
                    品番: <span style={{ color: "#9ca3af" }}>なし</span>
                    <span style={{ color: "#9ca3af", marginLeft: 12 }}>¥{g.remove.price?.toLocaleString() ?? "—"}</span>
                    <span style={{ color: "#9ca3af", marginLeft: 12 }}>ID: {g.remove.id.slice(0, 8)}…</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 要確認グループ（3件以上） ── */}
      {oddGroups.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: "bold", color: "#7c3aed", marginBottom: 12 }}>
            🔎 要確認（3件以上の重複: {oddGroups.length}グループ）
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {oddGroups.map((g) => (
              <div key={g.name} style={{ background: "#fff", border: "1px solid #ddd6fe", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ background: "#f5f3ff", borderBottom: "1px solid #ddd6fe", padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "#5b21b6" }}>
                  {g.name}（{g.rows.length}件）
                </div>
                {g.rows.map(r => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", padding: "8px 16px", gap: 12, fontSize: 12, borderBottom: "1px solid #f3f4f6" }}>
                    <span style={{ fontFamily: "monospace", color: "#6b7280" }}>{r.id.slice(0, 8)}…</span>
                    <span>品番: <strong>{r.product_code ?? "なし"}</strong></span>
                    <span style={{ color: "#9ca3af" }}>¥{r.price?.toLocaleString() ?? "—"}</span>
                    <span style={{ color: r.active ? "#059669" : "#dc2626" }}>{r.active ? "有効" : "無効"}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 重複なし */}
      {!loading && dupGroups.length === 0 && oddGroups.length === 0 && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: 28, textAlign: "center", color: "#166534" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: "bold" }}>重複商品はありません</div>
          <div style={{ fontSize: 13, color: "#4ade80", marginTop: 4 }}>商品データはクリーンな状態です</div>
        </div>
      )}

      {/* 再解析ボタン */}
      <div style={{ marginTop: 24 }}>
        <button onClick={analyze} disabled={loading || fixing}
          style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: "pointer", color: "#374151" }}>
          🔄 再解析
        </button>
      </div>
    </div>
  )
}
