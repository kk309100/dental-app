"use client"

// 清新宛て 月次請求書（下書き作成）。
// 明細 = 月額保守料 + 「初めて注文が入った月」以降の医院ごとの月額利用料（卸価格・満額）。
// 金額・行は画面上で直せる。印刷／PDF保存と、メール下書き（Gmail）に対応。何もDBには書き込まない。
// 請求元の住所・振込先は個人情報なので、コードには持たず、この端末のブラウザに保存する。

import { useEffect, useMemo, useState } from "react"
import { fetchAll } from "@/lib/supabase"

type Clinic = { id: string; name: string }
type Ord = { clinic_id: string; source: string | null; created_at: string }
type Line = { key: string; label: string; note: string; qty: number; price: number }

const jst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const yen = (n: number) => Math.round(n).toLocaleString("ja-JP")
const num = (v: string) => Number(String(v).replace(/[^0-9.\-]/g, "")) || 0
const LS = "denthub_seishin_invoice_v1"

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number)
  const last = new Date(y, m, 0).getDate()
  const nextLast = new Date(y, m + 1, 0)
  const f = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  return { issue: `${y}年${m}月${last}日`, due: f(nextLast), monthEnd: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`, label: `${y}年${m}月分` }
}

export default function SeishinBillingPage() {
  const now = new Date()
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`)
  const [orders, setOrders] = useState<Ord[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [basis, setBasis] = useState<"all" | "app">("app")          // 全注文 / 医院アプリ経由のみ（source が admin 以外）
  const [unit, setUnit] = useState(2400)
  const [maint, setMaint] = useState(5000)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())   // 請求に含めない医院
  const [extra, setExtra] = useState<Line[]>([])
  const [over, setOver] = useState<Record<string, Partial<Line>>>({})   // 行ごとの品名・数量・単価などの手直し
  const [removed, setRemoved] = useState<Set<string>>(new Set())        // 請求書から消した行
  const [invNo, setInvNo] = useState("")
  const [from, setFrom] = useState("")                              // 請求元
  const [bank, setBank] = useState("")                              // 振込先
  const [to, setTo] = useState("株式会社清新　御中")
  const [mailTo, setMailTo] = useState("")
  const [authUser, setAuthUser] = useState("")                      // メールを作るGoogleアカウント（複数ログイン時の取り違え防止）
  const [savedAt, setSavedAt] = useState("")

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || "{}")
      if (s.from) setFrom(s.from); if (s.bank) setBank(s.bank); if (s.mailTo) setMailTo(s.mailTo); if (s.authUser) setAuthUser(s.authUser)
    } catch { /* 保存データが無くても動く */ }
    Promise.all([
      fetchAll("orders", "id,clinic_id,source,created_at", (q: any) => q.order("id")),
      fetchAll("clinics", "id,name", (q: any) => q.order("id")),
    ]).then(([o, c]) => { setOrders(o as Ord[]); setClinics(c as Clinic[]); setLoading(false) })
  }, [])
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ from, bank, mailTo, authUser })) } catch { /* 保存できなくても使える */ }
  }, [from, bank, mailTo, authUser])

  const range = useMemo(() => monthRange(ym), [ym])
  useEffect(() => {
    setInvNo(`INV-${ym.replace("-", "")}-001`)
    // 保存済みの請求書があれば、その月の内容を復元する
    setSavedAt(""); setOver({}); setRemoved(new Set()); setExtra([]); setExcluded(new Set()); setTo("株式会社清新　御中")
    try {
      const raw = localStorage.getItem(`${LS}_inv_${ym}`)
      if (!raw) return
      const d = JSON.parse(raw)
      if (d.invNo) setInvNo(d.invNo)
      if (d.to) setTo(d.to)
      if (typeof d.maint === "number") setMaint(d.maint)
      if (typeof d.unit === "number") setUnit(d.unit)
      if (d.basis) setBasis(d.basis)
      setOver(d.over || {}); setRemoved(new Set(d.removed || [])); setExtra(d.extra || []); setExcluded(new Set(d.excluded || []))
      setSavedAt(d.savedAt || "")
    } catch { /* 読めなければ初期内容のまま */ }
  }, [ym])
  function saveInvoice() {
    try {
      const savedAtNow = new Date().toLocaleString("ja-JP")
      localStorage.setItem(`${LS}_inv_${ym}`, JSON.stringify({ invNo, to, maint, unit, basis, over, removed: Array.from(removed), extra, excluded: Array.from(excluded), savedAt: savedAtNow }))
      setSavedAt(savedAtNow)
    } catch { alert("保存できませんでした（ブラウザの保存が無効になっている可能性があります）") }
  }
  function clearSaved() {
    if (!confirm(`${ym} の保存内容を消して、初期の内容に戻します。よろしいですか？`)) return
    try { localStorage.removeItem(`${LS}_inv_${ym}`) } catch { /* 無視 */ }
    setSavedAt(""); setOver({}); setRemoved(new Set()); setExtra([]); setExcluded(new Set()); setTo("株式会社清新　御中"); setInvNo(`INV-${ym.replace("-", "")}-001`)
  }

  // 医院ごとの「初めて注文が入った日」（JST）
  const firstOrder = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) {
      if (basis === "app" && (!o.source || o.source === "admin")) continue
      const d = jst(o.created_at)
      if (!m.has(o.clinic_id) || d < (m.get(o.clinic_id) as string)) m.set(o.clinic_id, d)
    }
    return m
  }, [orders, basis])

  const nameOf = useMemo(() => new Map(clinics.map(c => [c.id, c.name])), [clinics])
  // 請求月の末日までに初回注文がある医院 = 稼働医院（初回の月も満額）
  const live = useMemo(() =>
    Array.from(firstOrder.entries()).filter(([, d]) => d <= range.monthEnd)
      .map(([id, d]) => ({ id, name: nameOf.get(id) || "(不明)", first: d }))
      .sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name, "ja")),
  [firstOrder, range, nameOf])

  const lines: Line[] = useMemo(() => [
    { key: "maint", label: "月額保守料", note: range.label, qty: 1, price: maint },
    ...live.filter(c => !excluded.has(c.id)).map(c => ({ key: c.id, label: `${c.name}　月額利用料`, note: `初回注文 ${c.first}`, qty: 1, price: unit })),
    ...extra,
  ].filter(l => !removed.has(l.key)).map(l => ({ ...l, ...(over[l.key] || {}) })), [live, excluded, unit, maint, range, extra, over, removed])
  const setLine = (key: string, patch: Partial<Line>) => setOver(p => ({ ...p, [key]: { ...(p[key] || {}), ...patch } }))

  const sub = lines.reduce((s, l) => s + l.qty * l.price, 0)
  const tax = Math.floor(sub * 0.1)
  const total = sub + tax

  const mailBody = `株式会社清新　御中\n\nお世話になっております。松浦です。\n${range.label}のDentHub利用料のご請求書をお送りします。\n\n・請求番号：${invNo}\n・ご請求金額（税込）：${yen(total)}円\n・お支払期限：${range.due}\n\nご確認のほど、よろしくお願いいたします。\n\n（請求書のPDFを添付してください）`
  const gmailUrl = `https://mail.google.com/mail/${authUser.trim() ? `?authuser=${encodeURIComponent(authUser.trim())}&` : "?"}view=cm&fs=1&to=${encodeURIComponent(mailTo)}&su=${encodeURIComponent(`【請求書】DentHub利用料 ${range.label}`)}&body=${encodeURIComponent(mailBody)}`

  const inp = "px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"

  return (
    <div className="space-y-4">
      <style>{`@media print { .no-print { display: none !important; } .inv-sheet { border: none !important; box-shadow: none !important; padding: 0 !important; } }`}</style>

      <div className="no-print">
        <h1 className="text-lg font-bold">🧾 清新への月次請求書（下書き）</h1>
        <p className="text-xs text-gray-500">月額保守料＋医院ごとの月額利用料（初めて注文が入った月から満額）で、請求書を作ります。内容を確認・修正して、印刷／PDF保存し、メールで送ってください。ここでは何も保存・送信しません。</p>
      </div>

      <div className="no-print bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label>請求月 <input type="month" value={ym} onChange={e => setYm(e.target.value)} className={inp} /></label>
          <label>保守料 <input value={maint} onChange={e => setMaint(num(e.target.value))} className={inp + " w-24 text-right"} />円</label>
          <label>医院ごとの月額 <input value={unit} onChange={e => setUnit(num(e.target.value))} className={inp + " w-24 text-right"} />円</label>
          <label>稼働の判定
            <select value={basis} onChange={e => setBasis(e.target.value as "all" | "app")} className={inp + " ml-1"}>
              <option value="app">医院アプリから注文した医院のみ（通常はこちら）</option>
              <option value="all">注文が1件でもある医院（スタッフ入力も含む）</option>
            </select>
          </label>
        </div>
        <details>
          <summary className="cursor-pointer text-xs text-blue-700">稼働医院の一覧（{live.length}件）・請求に含めない医院を外す</summary>
          <div className="mt-2 max-h-56 overflow-auto bg-white border border-gray-200 rounded p-2 grid gap-1 sm:grid-cols-2">
            {live.map(c => (
              <label key={c.id} className="text-xs flex items-center gap-2">
                <input type="checkbox" checked={!excluded.has(c.id)} onChange={() => setExcluded(p => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })} />
                <span>{c.name}</span><span className="text-gray-400">初回 {c.first}</span>
              </label>
            ))}
            {live.length === 0 && <span className="text-xs text-gray-400">該当する医院がありません</span>}
          </div>
        </details>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">請求元（住所・連絡先。この端末に保存されます）
            <textarea value={from} onChange={e => setFrom(e.target.value)} rows={3} className={inp + " w-full"} placeholder={"松浦　航大\n〒…\nメール・電話"} />
          </label>
          <label className="text-xs">振込先（この端末に保存されます）
            <textarea value={bank} onChange={e => setBank(e.target.value)} rows={3} className={inp + " w-full"} placeholder={"金融機関・支店\n口座種別・番号\n口座名義"} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs">宛先メール <input value={mailTo} onChange={e => setMailTo(e.target.value)} className={inp + " w-64"} placeholder="（任意）清新のメールアドレス" /></label>
          <label className="text-xs">送信に使うGmail <input value={authUser} onChange={e => setAuthUser(e.target.value)} className={inp + " w-52"} placeholder="あなたのGmailアドレス" /></label>
          <button onClick={saveInvoice} className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-bold">💾 この月の内容を保存</button>
          {savedAt && <button onClick={clearSaved} className="text-xs underline text-gray-500">保存内容を消す</button>}
          {savedAt && <span className="text-[11px] text-emerald-700">保存済み {savedAt}</span>}
          <button onClick={() => window.print()} className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-bold">🖨 印刷 / PDF保存</button>
          <a href={gmailUrl} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-bold">✉ Gmailで下書きを作る</a>
          <span className="text-[11px] text-gray-400">※ PDFは自動では添付されません。保存したPDFを、Gmailの下書きに添付してください。「送信に使うGmail」に、あなたのアドレスを入れると、そのアカウントで下書きが開きます（別のアカウントでログインしていても取り違えません）。</span>
        </div>
      </div>

      {loading ? <p className="text-sm text-gray-400">読み込み中…</p> : (
        <div className="inv-sheet bg-white border border-gray-300 rounded-lg p-8 max-w-[860px] mx-auto" style={{ fontFamily: '"Noto Sans JP", sans-serif' }}>
          <div className="flex justify-between items-start border-b-2 border-gray-800 pb-4 mb-5">
            <div>
              <div className="text-xs font-bold tracking-widest text-emerald-700">INVOICE</div>
              <div className="text-3xl font-bold tracking-[0.4em]" style={{ fontFamily: '"Noto Serif JP", serif' }}>請　求　書</div>
            </div>
            <div className="text-right text-sm leading-7">
              <div className="text-[11px] text-gray-500">請求番号</div>
              <div><input value={invNo} onChange={e => setInvNo(e.target.value)} className="text-right bg-transparent outline-none w-44" /></div>
              <div className="text-[11px] text-gray-500">発行日</div><div>{range.issue}</div>
              <div className="text-[11px] text-gray-500">お支払期限</div><div>{range.due}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
            <div className="bg-slate-50 rounded p-3">
              <div className="text-[11px] text-gray-500 font-bold">請求先</div>
              <input value={to} onChange={e => setTo(e.target.value)} className="text-base font-bold bg-transparent outline-none w-full" />
            </div>
            <div className="bg-slate-50 rounded p-3">
              <div className="text-[11px] text-gray-500 font-bold">請求元</div>
              <div className="whitespace-pre-line text-sm">{from || "（上の「請求元」欄に入力してください）"}</div>
            </div>
          </div>

          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead><tr className="bg-slate-800 text-white text-xs">
              <th className="text-left px-3 py-2">品目・内容</th><th className="px-3 py-2 text-right w-14">数量</th>
              <th className="px-3 py-2 text-right w-28">単価（税別）</th><th className="px-3 py-2 text-right w-28">金額（税別）</th>
            </tr></thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.key} className="border-b border-gray-200">
                  <td className="px-3 py-2">
                    <input value={l.label} onChange={e => setLine(l.key, { label: e.target.value })} className="font-semibold bg-transparent outline-none w-full hover:bg-yellow-50 focus:bg-yellow-50" />
                    <input value={l.note} onChange={e => setLine(l.key, { note: e.target.value })} className="text-xs text-gray-500 bg-transparent outline-none w-full hover:bg-yellow-50 focus:bg-yellow-50" placeholder="（補足：任意）" />
                  </td>
                  <td className="px-3 py-2 text-right"><input value={l.qty} onChange={e => setLine(l.key, { qty: num(e.target.value) })} className="w-12 text-right bg-transparent outline-none hover:bg-yellow-50 focus:bg-yellow-50" /></td>
                  <td className="px-3 py-2 text-right">¥<input value={yen(l.price)} onChange={e => setLine(l.key, { price: num(e.target.value) })} className="w-20 text-right bg-transparent outline-none hover:bg-yellow-50 focus:bg-yellow-50" /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">¥{yen(l.qty * l.price)} <button onClick={() => setRemoved(p => new Set(p).add(l.key))} className="no-print ml-1 text-xs text-gray-400 hover:text-red-600" title="この行を請求書から消す">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="no-print mt-2">
            <button onClick={() => setExtra(p => [...p, { key: "x" + Date.now(), label: "追加項目", note: "", qty: 1, price: 0 }])} className="text-xs px-2 py-1 border rounded">＋ 項目を追加</button>
            {removed.size > 0 && <button onClick={() => setRemoved(new Set())} className="ml-2 text-xs px-2 py-1 border rounded">消した行を元に戻す</button>}
            <span className="ml-2 text-[11px] text-gray-400">※ 表の品名・補足・数量・単価は、クリックして直接書き換えられます。</span>
          </div>

          <div className="mt-4 ml-auto w-72 text-sm">
            <div className="flex justify-between py-1"><span>小計</span><span>¥{yen(sub)}</span></div>
            <div className="flex justify-between py-1"><span>消費税（10%）</span><span>¥{yen(tax)}</span></div>
            <div className="flex justify-between py-2 border-t-2 border-gray-800 text-lg font-bold"><span>合計（税込）</span><span>¥{yen(total)}</span></div>
          </div>

          <div className="mt-6 text-sm">
            <div className="text-xs font-bold text-emerald-700 border-b border-gray-200 pb-1 mb-2">振込先</div>
            <div className="whitespace-pre-line bg-slate-50 rounded p-3">{bank || "（上の「振込先」欄に入力してください）"}</div>
            <p className="text-xs text-gray-500 mt-3">・振込手数料はご負担ください。</p>
          </div>
        </div>
      )}
    </div>
  )
}
