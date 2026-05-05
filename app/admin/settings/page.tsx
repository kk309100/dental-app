"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { clearCompanyCache } from "@/lib/company"

type Settings = {
  company_name: string
  postal_code: string
  address: string
  phone: string
  fax: string
  email: string
  representative: string
  invoice_registration_number: string
  bank_name: string
  bank_branch: string
  bank_type: string
  bank_number: string
  bank_holder: string
  seal_image_url: string
  logo_image_url: string
  invoice_footer: string
}

const empty: Settings = {
  company_name: "", postal_code: "", address: "", phone: "", fax: "", email: "",
  representative: "", invoice_registration_number: "",
  bank_name: "", bank_branch: "", bank_type: "普通", bank_number: "", bank_holder: "",
  seal_image_url: "", logo_image_url: "", invoice_footer: "",
}

export default function SettingsPage() {
  const [form, setForm] = useState<Settings>(empty)
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data, error } = await supabase.from("company_settings").select("*").eq("id", 1).single()
    if (error) {
      // テーブル無い、または初回（行無し）
      if (error.code === "PGRST116" || error.code === "42P01") {
        setTableMissing(error.code === "42P01")
      }
    } else if (data) {
      setForm({
        company_name: data.company_name || "",
        postal_code: data.postal_code || "",
        address: data.address || "",
        phone: data.phone || "",
        fax: data.fax || "",
        email: data.email || "",
        representative: data.representative || "",
        invoice_registration_number: data.invoice_registration_number || "",
        bank_name: data.bank_name || "",
        bank_branch: data.bank_branch || "",
        bank_type: data.bank_type || "普通",
        bank_number: data.bank_number || "",
        bank_holder: data.bank_holder || "",
        seal_image_url: data.seal_image_url || "",
        logo_image_url: data.logo_image_url || "",
        invoice_footer: data.invoice_footer || "",
      })
    }
    setLoading(false)
  }

  async function save() {
    setSaving(true); setMsg("")
    // 適格請求書登録番号の形式チェック
    if (form.invoice_registration_number && !/^T\d{13}$/.test(form.invoice_registration_number)) {
      setMsg("⚠ 適格請求書登録番号は T で始まる13桁の数字（例: T1234567890123）です")
      setSaving(false); return
    }
    const payload = { ...form, id: 1, updated_at: new Date().toISOString() }
    const { error } = await supabase.from("company_settings").upsert(payload, { onConflict: "id" })
    if (error) {
      setMsg("保存失敗: " + error.message)
    } else {
      clearCompanyCache()
      setMsg("✅ 保存しました（請求書・納品書に反映されます）")
    }
    setSaving(false)
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  if (tableMissing) {
    return (
      <div className="max-w-2xl mx-auto bg-amber-50 border border-amber-200 rounded-lg p-6 mt-12">
        <h1 className="text-lg font-bold text-amber-900 mb-2">⚙ 自社情報設定（未セットアップ）</h1>
        <p className="text-sm text-amber-800">company_settings テーブルがまだ作成されていません。<br />
          Supabase Studio で <code className="bg-white px-1.5 py-0.5 rounded">db/migrations/2026-05-05_phase6-10.sql</code> を実行してください。
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">自社情報設定</h1>
        <span className="text-xs text-gray-400">請求書・納品書・発注書に印字されます</span>
      </div>

      {msg && (
        <div className={"text-xs px-3 py-2 rounded " + (msg.startsWith("✅") ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200")}>
          {msg}
        </div>
      )}

      <Section title="会社基本情報">
        <Field label="会社名 *" value={form.company_name} onChange={v => setForm({ ...form, company_name: v })} />
        <Field label="代表者" value={form.representative} onChange={v => setForm({ ...form, representative: v })} />
        <Field label="郵便番号" value={form.postal_code} onChange={v => setForm({ ...form, postal_code: v })} placeholder="454-0812" />
        <Field label="住所" value={form.address} onChange={v => setForm({ ...form, address: v })} />
        <Field label="電話" value={form.phone} onChange={v => setForm({ ...form, phone: v })} />
        <Field label="FAX" value={form.fax} onChange={v => setForm({ ...form, fax: v })} />
        <Field label="メール" value={form.email} onChange={v => setForm({ ...form, email: v })} />
      </Section>

      <Section title="適格請求書（インボイス）">
        <Field label="適格請求書発行事業者 登録番号" value={form.invoice_registration_number}
          onChange={v => setForm({ ...form, invoice_registration_number: v })}
          placeholder="T1234567890123（T + 13桁）" />
        <p className="text-xs text-gray-500 mt-2">
          ※ 国税庁の<a href="https://www.invoice-kohyo.nta.go.jp/" target="_blank" rel="noopener" className="text-blue-600 underline">適格請求書発行事業者公表サイト</a>で確認できます。
        </p>
      </Section>

      <Section title="振込先情報（請求書に印字）">
        <Field label="銀行名" value={form.bank_name} onChange={v => setForm({ ...form, bank_name: v })} />
        <Field label="支店名" value={form.bank_branch} onChange={v => setForm({ ...form, bank_branch: v })} />
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="預金種別" value={form.bank_type} onChange={v => setForm({ ...form, bank_type: v })}
            options={["普通", "当座"]} />
          <Field label="口座番号" value={form.bank_number} onChange={v => setForm({ ...form, bank_number: v })} />
        </div>
        <Field label="口座名義" value={form.bank_holder} onChange={v => setForm({ ...form, bank_holder: v })} placeholder="カ）セイシン" />
      </Section>

      <Section title="帳票デザイン">
        <Field label="ロゴ画像 URL" value={form.logo_image_url} onChange={v => setForm({ ...form, logo_image_url: v })}
          placeholder="https://… または /logo.png" />
        <Field label="社判画像 URL" value={form.seal_image_url} onChange={v => setForm({ ...form, seal_image_url: v })}
          placeholder="/seal.png" />
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">請求書フッター</label>
          <textarea value={form.invoice_footer} onChange={e => setForm({ ...form, invoice_footer: e.target.value })}
            rows={2} placeholder="振込手数料は貴院負担でお願いいたします。"
            className="w-full px-3 py-2 border border-gray-200 rounded text-sm" />
        </div>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-2 sticky bottom-2">
        <Link href="/admin" className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">キャンセル</Link>
        <button onClick={save} disabled={saving}
          className="px-5 py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300">
          {saving ? "保存中…" : "✓ 保存"}
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg p-4 space-y-2" style={{ border: "1px solid #e8eaed" }}>
      <h2 className="text-sm font-bold text-gray-700 mb-2">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-700 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 rounded text-sm" />
    </div>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-700 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded text-sm bg-white">
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  )
}
