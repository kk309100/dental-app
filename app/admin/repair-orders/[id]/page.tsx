"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { COMPANY } from "@/lib/company"
import Link from "next/link"

type Clinic = { id: string; name: string; adress: string | null; phone: string | null }

const STATUSES    = ["受付中", "対応中", "修理完了", "返却済み", "キャンセル"] as const
const DESTINATIONS = ["自社対応", "メーカー修理", "外注（修理業者）", "その他"]
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  "受付中":    { bg: "#fef3c7", color: "#92400e" },
  "対応中":    { bg: "#dbeafe", color: "#1e40af" },
  "修理完了":  { bg: "#dcfce7", color: "#15803d" },
  "返却済み":  { bg: "#f3f4f6", color: "#6b7280" },
  "キャンセル":{ bg: "#f3f4f6", color: "#6b7280" },
}

export default function RepairOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }  = use(params)
  const isNew   = id === "new"
  const router  = useRouter()

  const [clinics, setClinics]           = useState<Clinic[]>([])
  const [loading, setLoading]           = useState(!isNew)
  const [saving,   setSaving]            = useState(false)
  const [saved,    setSaved]             = useState(false)
  const [errorMsg, setErrorMsg]          = useState("")

  // フォーム値
  const [clinicId,           setClinicId]           = useState("")
  const [contactPerson,      setContactPerson]      = useState("")
  const [equipmentName,      setEquipmentName]      = useState("")
  const [modelNumber,        setModelNumber]        = useState("")
  const [faultDescription,   setFaultDescription]   = useState("")
  const [desiredDelivery,    setDesiredDelivery]    = useState("")
  const [repairDestination,  setRepairDestination]  = useState("自社対応")
  const [status,             setStatus]             = useState("受付中")
  const [notes,              setNotes]              = useState("")
  const [receiptNumber,      setReceiptNumber]      = useState("")
  const [createdAt,          setCreatedAt]          = useState("")

  useEffect(() => {
    loadClinics()
    if (!isNew) loadOrder()
  }, [id])

  async function loadClinics() {
    const { data, error } = await supabase.from("clinics").select("id,name,adress,phone").order("name").limit(10000)
    if (error) {
      console.error("[repair-orders] loadClinics error:", error)
      setErrorMsg("医院情報の取得に失敗しました: " + error.message)
      return
    }
    setClinics((data as Clinic[]) || [])
  }

  async function loadOrder() {
    const { data } = await supabase.from("repair_orders").select("*").eq("id", id).single()
    if (data) {
      setClinicId(data.clinic_id || "")
      setContactPerson(data.contact_person || "")
      setEquipmentName(data.equipment_name || "")
      setModelNumber(data.model_number || "")
      setFaultDescription(data.fault_description || "")
      setDesiredDelivery(data.desired_delivery_date || "")
      setRepairDestination(data.repair_destination || "自社対応")
      setStatus(data.status || "受付中")
      setNotes(data.notes || "")
      setReceiptNumber(data.receipt_number || "")
      setCreatedAt(data.created_at || "")
    }
    setLoading(false)
  }

  async function save() {
    if (!equipmentName.trim()) { alert("機器名・品名を入力してください"); return }
    setSaving(true)
    setSaved(false)
    setErrorMsg("")

    try {
      if (isNew) {
        // 受付番号生成 RO-YYYYMMDD-XXXX
        const now = new Date()
        const y   = now.getFullYear()
        const m   = String(now.getMonth() + 1).padStart(2, "0")
        const d   = String(now.getDate()).padStart(2, "0")
        const { data: ex } = await supabase.from("repair_orders").select("id")
          .gte("created_at", `${y}-${m}-${d}T00:00:00`)
          .lte("created_at", `${y}-${m}-${d}T23:59:59`)
        const rn = `RO-${y}${m}${d}-${String((ex?.length || 0) + 1).padStart(4, "0")}`

        const { data, error } = await supabase.from("repair_orders").insert([{
          receipt_number:        rn,
          clinic_id:             clinicId || null,
          contact_person:        contactPerson.trim() || null,
          equipment_name:        equipmentName.trim(),
          model_number:          modelNumber.trim() || null,
          fault_description:     faultDescription.trim() || null,
          desired_delivery_date: desiredDelivery || null,
          repair_destination:    repairDestination,
          status,
          notes:                 notes.trim() || null,
        }]).select().single()

        if (error) {
          console.error("[repair-orders] insert error:", error)
          const msg = error.code === "42501"
            ? "保存失敗: 権限エラーです。Supabase の repair_orders テーブルの RLS を確認してください。\n\nコード: " + error.code
            : "保存失敗: " + (error.message || JSON.stringify(error))
          setErrorMsg(msg)
          setSaving(false)
          return
        }
        if (!data) {
          setErrorMsg("保存失敗: データが返ってきませんでした。Supabase の RLS ポリシーを確認してください。")
          setSaving(false)
          return
        }
        router.replace(`/admin/repair-orders/${data.id}`)
      } else {
        const { error } = await supabase.from("repair_orders").update({
          clinic_id:             clinicId || null,
          contact_person:        contactPerson.trim() || null,
          equipment_name:        equipmentName.trim(),
          model_number:          modelNumber.trim() || null,
          fault_description:     faultDescription.trim() || null,
          desired_delivery_date: desiredDelivery || null,
          repair_destination:    repairDestination,
          status,
          notes:                 notes.trim() || null,
          updated_at:            new Date().toISOString(),
        }).eq("id", id)

        if (error) {
          console.error("[repair-orders] update error:", error)
          setErrorMsg("保存失敗: " + (error.message || JSON.stringify(error)))
          setSaving(false)
          return
        }
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (e) {
      console.error("[repair-orders] unexpected error:", e)
      setErrorMsg("予期せぬエラー: " + (e as Error).message)
    }
    setSaving(false)
  }

  const selectedClinic = clinics.find(c => c.id === clinicId)
  const dateStr = createdAt ? createdAt.slice(0, 10).replace(/-/g, "/") : new Date().toLocaleDateString("ja-JP")
  const ss = STATUS_STYLE[status] || { bg: "#f3f4f6", color: "#6b7280" }

  if (loading) return <p style={{ color: "#9ca3af", textAlign: "center", padding: 40 }}>読み込み中…</p>

  return (
    <div>
      {/* ── 操作パネル（印刷時非表示） ── */}
      <div className="no-print">
        {/* パンくず */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, color: "#9ca3af" }}>
          <Link href="/admin/repair-orders" style={{ color: "#2563eb", textDecoration: "none" }}>修理依頼一覧</Link>
          <span>›</span>
          <span>{isNew ? "新規作成" : (receiptNumber || "詳細")}</span>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "20px 24px", marginBottom: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
              🔧 {isNew ? "新規修理依頼書" : `修理依頼書 ${receiptNumber}`}
            </h1>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!isNew && (
                <button onClick={() => window.print()} style={{
                  padding: "9px 18px", background: "#111", color: "#fff",
                  border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}>
                  🖨 印刷
                </button>
              )}
              <button onClick={save} disabled={saving} style={{
                padding: "9px 22px",
                background: saving ? "#9ca3af" : "#2563eb",
                color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
              }}>
                {saving ? "保存中…" : isNew ? "✓ 作成する" : "💾 保存"}
              </button>
            </div>
          </div>

          {saved && (
            <div style={{ marginBottom: 14, padding: "8px 14px", background: "#dcfce7", borderRadius: 8, fontSize: 13, color: "#166534", fontWeight: 600 }}>
              ✓ 保存しました
            </div>
          )}
          {errorMsg && (
            <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fef2f2", borderRadius: 8, fontSize: 13, color: "#991b1b", border: "1px solid #fca5a5", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
              ⚠ {errorMsg}
              <button onClick={() => setErrorMsg("")} style={{ float: "right", background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
          )}

          {/* ステータス（編集時） */}
          {!isNew && (
            <div style={{ marginBottom: 18, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>ステータス</span>
              <select value={status} onChange={e => setStatus(e.target.value)}
                style={{ padding: "5px 10px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: 700, background: ss.bg, color: ss.color, cursor: "pointer" }}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          )}

          {/* フォーム */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            <Field label="依頼医院">
              <select value={clinicId} onChange={e => setClinicId(e.target.value)} style={sel}>
                <option value="">{clinics.length === 0 ? "（読み込み中…）" : "（選択してください）"}</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {clinics.length === 0 && !errorMsg && (
                <p style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>
                  ⚠ 医院データが見つかりません。<a href="/admin/clinics" style={{ color: "#2563eb" }}>医院マスタ</a>を確認してください。
                </p>
              )}
              {/* 選択した医院の情報プレビュー */}
              {selectedClinic && (
                <div style={{ marginTop: 6, padding: "7px 10px", background: "#f0f5ff", borderRadius: 7, fontSize: 11, color: "#374151", lineHeight: 1.7 }}>
                  {selectedClinic.adress && <div>📍 {selectedClinic.adress}</div>}
                  {selectedClinic.phone  && <div>📞 {selectedClinic.phone}</div>}
                  {!selectedClinic.adress && !selectedClinic.phone && (
                    <span style={{ color: "#9ca3af" }}>住所・電話未登録（<a href="/admin/clinics" style={{ color: "#2563eb" }}>医院マスタ</a>から登録できます）</span>
                  )}
                </div>
              )}
            </Field>
            <Field label="担当者名">
              <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="例：山田 太郎" style={inp} />
            </Field>
            <Field label="機器名・品名 *">
              <input value={equipmentName} onChange={e => setEquipmentName(e.target.value)} placeholder="例：歯科用ハンドピース" style={{ ...inp, borderColor: equipmentName ? "#d1d5db" : "#fca5a5" }} />
            </Field>
            <Field label="型番">
              <input value={modelNumber} onChange={e => setModelNumber(e.target.value)} placeholder="例：NSK-ABC123" style={inp} />
            </Field>
            <Field label="修理先">
              <select value={repairDestination} onChange={e => setRepairDestination(e.target.value)} style={sel}>
                {DESTINATIONS.map(d => <option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="希望納期">
              <input type="date" value={desiredDelivery} onChange={e => setDesiredDelivery(e.target.value)} style={inp} />
            </Field>
            <Field label="故障内容・症状" full>
              <textarea value={faultDescription} onChange={e => setFaultDescription(e.target.value)}
                placeholder="症状や故障の詳細を記入してください"
                rows={4} style={{ ...inp, resize: "vertical", lineHeight: 1.6, whiteSpace: "pre-wrap" }} />
            </Field>
            <Field label="備考" full>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="その他メモ"
                rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.6 }} />
            </Field>
          </div>
        </div>
      </div>

      {/* ── 印刷プレビュー（常に描画、画面では薄くプレビュー） ── */}
      {!isNew && (
        <div className="print-area" style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        }}>
          <p className="no-print" style={{ fontSize: 11, color: "#9ca3af", marginBottom: 16 }}>
            ↓ 印刷プレビュー（🖨 印刷ボタンで印刷できます）
          </p>
          <PrintSheet
            receiptNumber={receiptNumber}
            dateStr={dateStr}
            clinicName={selectedClinic?.name || ""}
            clinicAdress={selectedClinic?.adress || ""}
            clinicPhone={selectedClinic?.phone || ""}
            contactPerson={contactPerson}
            equipmentName={equipmentName}
            modelNumber={modelNumber}
            faultDescription={faultDescription}
            desiredDelivery={desiredDelivery}
            repairDestination={repairDestination}
            status={status}
            notes={notes}
          />
        </div>
      )}

      <style jsx global>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-area { border: none !important; box-shadow: none !important; padding: 0 !important; border-radius: 0 !important; }
          @page { size: A4; margin: 15mm; }
        }
        @media screen {
          .print-area { max-width: 720px; }
        }
      `}</style>
    </div>
  )
}

// ── フォームフィールドラッパー ──────────────────────────────
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={full ? { gridColumn: "1 / -1" } : {}}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

// ── 印刷シート ────────────────────────────────────────────
function PrintSheet({
  receiptNumber, dateStr, clinicName, clinicAdress, clinicPhone,
  contactPerson, equipmentName, modelNumber, faultDescription,
  desiredDelivery, repairDestination, status, notes,
}: {
  receiptNumber: string; dateStr: string; clinicName: string; clinicAdress: string; clinicPhone: string;
  contactPerson: string; equipmentName: string; modelNumber: string; faultDescription: string;
  desiredDelivery: string; repairDestination: string; status: string; notes: string;
}) {
  const statusStyle = STATUS_STYLE[status] || { bg: "#f3f4f6", color: "#6b7280" }
  return (
    <div style={{ fontFamily: "'Noto Sans JP', 'Yu Gothic', sans-serif", fontSize: 11, color: "#111", lineHeight: 1.6 }}>
      {/* タイトル行 */}
      <div style={{ borderBottom: "2px solid #111", paddingBottom: 6, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <h1 style={{ fontSize: 18, letterSpacing: "0.3em", margin: 0, fontWeight: 800 }}>修 理 依 頼 書</h1>
        <div style={{ textAlign: "right", fontSize: 10 }}>
          <div style={{ fontWeight: 700 }}>No. {receiptNumber}</div>
          <div style={{ color: "#555", marginTop: 1 }}>依頼日: {dateStr}</div>
          <div style={{
            display: "inline-block", marginTop: 4, padding: "2px 10px",
            borderRadius: 4, fontSize: 10, fontWeight: 700,
            background: statusStyle.bg, color: statusStyle.color,
          }}>{status}</div>
        </div>
      </div>

      {/* 自社情報（右上） */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <div style={{ fontSize: 9, lineHeight: 1.6, textAlign: "right", color: "#444" }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#111" }}>{COMPANY.name}</p>
          <p style={{ margin: 0 }}>〒{COMPANY.postalCode}　{COMPANY.address}</p>
          <p style={{ margin: 0 }}>TEL {COMPANY.phone}{COMPANY.fax ? `　FAX ${COMPANY.fax}` : ""}</p>
        </div>
      </div>

      {/* 明細テーブル */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginBottom: 16 }}>
        <tbody>
          {/* ── 医院情報ブロック ── */}
          <tr>
            <td colSpan={2} style={{ ...cell, background: "#1e3a8a", padding: "5px 10px" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: "0.06em" }}>依頼医院情報</span>
            </td>
          </tr>
          <tr>
            <td style={{ ...cell, background: "#f0f5ff", fontWeight: 600, width: "30%", color: "#1e3a8a", fontSize: 12 }}>医院名</td>
            <td style={{ ...cell, fontWeight: 700, fontSize: 14 }}>{clinicName || "（未選択）"}</td>
          </tr>
          <tr>
            <td style={{ ...cell, background: "#f0f5ff", fontWeight: 600, color: "#1e3a8a" }}>住所</td>
            <td style={cell}>{clinicAdress || "—"}</td>
          </tr>
          <tr>
            <td style={{ ...cell, background: "#f0f5ff", fontWeight: 600, color: "#1e3a8a" }}>電話番号</td>
            <td style={cell}>{clinicPhone || "—"}</td>
          </tr>
          <tr>
            <td style={{ ...cell, background: "#f0f5ff", fontWeight: 600, color: "#1e3a8a" }}>担当者名</td>
            <td style={cell}>{contactPerson || "—"}</td>
          </tr>
          {/* ── 修理内容ブロック ── */}
          <tr>
            <td colSpan={2} style={{ ...cell, background: "#374151", padding: "5px 10px" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: "0.06em" }}>修理内容</span>
            </td>
          </tr>
          {[
            ["機器名・品名", equipmentName || "—", true],
            ["型番・品番",   modelNumber || "—",   false],
            ["修理先",       repairDestination || "—", false],
            ["希望納期",     desiredDelivery || "—", false],
          ].map(([label, value, bold]) => (
            <tr key={label as string}>
              <td style={{ ...cell, background: "#f9fafb", fontWeight: 600, width: "30%", color: "#555" }}>{label}</td>
              <td style={{ ...cell, fontWeight: bold ? 700 : 400, fontSize: bold ? 13 : 11 }}>{value}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cell, background: "#f9fafb", fontWeight: 600, color: "#555", verticalAlign: "top" }}>故障内容・症状</td>
            <td style={{ ...cell, whiteSpace: "pre-wrap", minHeight: 60 }}>{faultDescription || "（記載なし）"}</td>
          </tr>
          <tr>
            <td style={{ ...cell, background: "#f9fafb", fontWeight: 600, color: "#555", verticalAlign: "top" }}>備考</td>
            <td style={{ ...cell, whiteSpace: "pre-wrap", minHeight: 32 }}>{notes || "—"}</td>
          </tr>
        </tbody>
      </table>

      {/* 確認欄 */}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        {["受付担当", "確認", "返却確認"].map(label => (
          <div key={label} style={{
            flex: 1, border: "1px solid #aaa", borderRadius: 4, padding: "6px 10px", textAlign: "center",
          }}>
            <p style={{ margin: 0, fontSize: 9, color: "#888" }}>{label}</p>
            <div style={{ height: 32, borderBottom: "1px dashed #ccc", marginTop: 4, marginBottom: 4 }} />
            <p style={{ margin: 0, fontSize: 9, color: "#bbb" }}>印</p>
          </div>
        ))}
        <div style={{ flex: 2, border: "1px solid #aaa", borderRadius: 4, padding: "6px 10px" }}>
          <p style={{ margin: 0, fontSize: 9, color: "#888" }}>対応メモ</p>
          <div style={{ height: 46 }} />
        </div>
      </div>
    </div>
  )
}

// ── スタイル定数 ───────────────────────────────────────────
const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 12px",
  border: "1.5px solid #d1d5db", borderRadius: 8, fontSize: 13,
  outline: "none", background: "#fff", color: "#111",
}
const sel: React.CSSProperties = { ...inp, cursor: "pointer" }
const cell: React.CSSProperties = {
  padding: "7px 10px", border: "1px solid #ddd", verticalAlign: "middle",
}
