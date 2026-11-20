"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { parseDbDate } from "@/lib/invoice"
import { PRINT_CSS } from "@/lib/print-layout-css"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"

type PO = { id: string; po_number: string | null; supplier_id: string | null; ordered_at: string | null; expected_at: string | null; total_amount: number | null; note: string | null; sent_method: string | null; sent_at?: string | null; status: string }
type Item = { id: string; purchase_order_id: string; product_id: string | null; product_name: string | null; quantity: number; unit_price: number; note: string | null }
type Supplier = { id: string; name: string; address: string | null; phone: string | null; fax: string | null; contact: string | null }

// 明細のnote「[医院名] 注文 xxxxxxxx」の医院名部分を、印刷時は医院コードに置き換える
function noteForPrint(note: string, clinicCodeByName: Map<string, string>): string {
  const m = note.match(/^\[(.+?)\](.*)$/)
  if (!m) return note
  const code = clinicCodeByName.get(m[1])
  return code ? `[${code}]${m[2]}` : note
}

// 1枚に入る行数（最後のページに、注記と備考が入る余裕を残す）
const FIRST_ROWS = 16
const REST_ROWS = 20

export default function BulkPrintWrapper() {
  return (
    <Suspense fallback={<p>読み込み中…</p>}>
      <BulkPrint />
    </Suspense>
  )
}

function BulkPrint() {
  const sp = useSearchParams()
  const ids = (sp.get("ids") || "").split(",").filter(Boolean)
  const [pos, setPos] = useState<PO[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [clinicCodeByName, setClinicCodeByName] = useState<Map<string, string>>(new Map())
  const [manufacturerByProduct, setManufacturerByProduct] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (ids.length === 0) return
    let cancelled = false
    let printTimer: ReturnType<typeof setTimeout> | null = null
    Promise.all([
      supabase.from("purchase_orders").select("*").in("id", ids),
      supabase.from("purchase_order_items").select("*").in("purchase_order_id", ids),
      supabase.from("suppliers").select("*").limit(50000),
      supabase.from("clinics").select("name,clinic_code").limit(50000),
    ]).then(async ([p, i, s, c]) => {
      if (cancelled) return
      const itemsData = (i.data as Item[]) || []
      setPos((p.data as PO[]) || [])
      setItems(itemsData)
      setSuppliers((s.data as Supplier[]) || [])
      const map = new Map<string, string>()
      ;((c.data as any[]) || []).forEach(cl => { if (cl.clinic_code) map.set(cl.name, cl.clinic_code) })
      setClinicCodeByName(map)
      const productIds = Array.from(new Set(itemsData.map(it => it.product_id).filter((id): id is string => !!id)))
      if (productIds.length > 0) {
        const { data: prods } = await supabase.from("products").select("id,manufacturer").in("id", productIds)
        const mMap = new Map<string, string>()
        ;(prods || []).forEach((pr: any) => { if (pr.manufacturer) mMap.set(pr.id, pr.manufacturer) })
        if (!cancelled) setManufacturerByProduct(mMap)
      }
      printTimer = setTimeout(() => { if (!cancelled) window.print() }, 800)
    })
    return () => {
      cancelled = true
      if (printTimer) clearTimeout(printTimer)
    }
  }, [ids.join(",")])

  // 「送付済みにする」は明示的なボタン操作でのみ記録する
  // （印刷ダイアログを開いただけ・プレビューしただけでは記録しない。
  //   ブラウザのafterprintイベントはキャンセル時にも発火するなど不確実なため使わない）
  //
  // この一覧印刷は発注プール画面の「発注書を発行する」（下書き→未送付）を経由せず
  // 下書きのまま直接開けるため、送付済みにする際に「まだ下書き・未送付のPO」を
  // まとめて発注済へ確定する。これをしないと「FAX済みなのに発注済になっていない」
  // という矛盾した状態になり、入荷処理ボタンが出せなくなる（実際に発生した不具合）。
  // 逆に、ここを通らない限り status は「発注済」にはならない
  // （プール確定の時点ではまだ「未送付」のまま＝実際に送るまでは発注済と表示しない）。
  const [marking, setMarking] = useState(false)
  async function markSent() {
    setMarking(true)
    const now = new Date().toISOString()
    await supabase.from("purchase_orders").update({ sent_method: "FAX", sent_at: now }).in("id", ids)
    // 画面上の React state（pos）は読み込みタイミング次第で古い・空のことがあるため、
    // 「まだ未送付のもの」の判定はクライアント側の状態に頼らず、DBに直接条件を指定する
    // （そうしないと sent_method/sent_at だけ更新されて status が「未送付」のまま
    //   取り残される不具合が起きる）
    await supabase.from("purchase_orders").update({ status: "発注済", ordered_at: now })
      .in("id", ids).not("status", "in", "(発注済,部分入荷,入荷済)")
    const { data: refreshed } = await supabase.from("purchase_orders").select("*").in("id", ids)
    if (refreshed) setPos(refreshed as PO[])
    setMarking(false)
  }

  const supBy = new Map(suppliers.map(s => [s.id, s]))
  const itemsByPO = new Map<string, Item[]>()
  items.forEach(i => { if (!itemsByPO.has(i.purchase_order_id)) itemsByPO.set(i.purchase_order_id, []); itemsByPO.get(i.purchase_order_id)!.push(i) })
  const allSent = pos.length > 0 && pos.every(po => po.sent_method === "FAX")

  return (
    <>
      <div className="no-print p-4 bg-yellow-50 border-b border-yellow-200 sticky top-0">
        <button onClick={() => {
          window.print()
          // window.print() はダイアログが閉じるまで処理をブロックするため、
          // afterprint イベント（キャンセル時にも発火して不確実）を使わずここで確認できる
          if (!allSent && confirm("印刷しました。この発注書を「送付済み」として記録しますか？")) markSent()
        }} className="px-4 py-2 bg-gray-900 text-white text-sm rounded mr-2">🖨 印刷</button>
        <button
          onClick={markSent}
          disabled={marking || allSent}
          className={"px-4 py-2 text-sm rounded mr-2 font-bold " + (allSent ? "bg-emerald-100 text-emerald-700" : "bg-blue-600 text-white")}
          title="実際にFAXで送付し終えたら押してください">
          {allSent ? "📠 送付済みとして記録済み" : marking ? "記録中…" : "📠 送付済みにする"}
        </button>
        <button onClick={() => window.close()} className="px-4 py-2 bg-gray-200 text-sm rounded">閉じる</button>
        <span className="ml-3 text-xs text-gray-700">{pos.length}件の発注書</span>
      </div>
      <div className="oq po-gothic">
        <style>{PRINT_CSS}</style>
        {/* 発注書だけ、ゴシック体にする（ほかの書類は、MS明朝のまま） */}
        <style>{`
          .oq.po-gothic, .oq.po-gothic * { font-family: "MS PGothic", "ＭＳ Ｐゴシック", "Yu Gothic", "Meiryo", sans-serif !important; }
          .oq.po-gothic, .oq.po-gothic * { -webkit-text-stroke: 0.15px currentColor; }
        `}</style>
        {pos.map((po) => {
          const sup = po.supplier_id ? supBy.get(po.supplier_id) : null
          const its = itemsByPO.get(po.id) || []
          const no = po.po_number || po.id.slice(0, 8)
          const dateStr = po.ordered_at ? parseDbDate(po.ordered_at).toLocaleDateString("ja-JP") : ""
          const pages: Item[][] = [its.slice(0, FIRST_ROWS)]
          for (let i = FIRST_ROWS; i < its.length; i += REST_ROWS) pages.push(its.slice(i, i + REST_ROWS))
          return pages.map((rows, pi) => (
            <section className="page" key={po.id + "-" + pi}>
              <header className="head">
                <h1>発 注 書</h1>
                <div className="meta">{dateStr}<br />No. {no}{pi > 0 ? <><br />（続き）</> : null}</div>
              </header>
              {pi === 0 && (
                <>
                  <div className="to">{sup?.name || "(仕入先未設定)"}　御中</div>
                  {sup?.address && <div style={{ fontSize: 11, margin: "-4px 0 2px" }}>{sup.address}</div>}
                  {sup?.phone && <div style={{ fontSize: 11, margin: "0 0 8px" }}>TEL {sup.phone}{sup.fax ? `　FAX ${sup.fax}` : ""}</div>}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginTop: 6 }}>
                    <div className="gt terms" style={{ gridTemplateColumns: "34% 1fr", gridAutoRows: "6.2mm" }}>
                      <div className="h">発 注 日</div><div className="l">{dateStr}</div>
                      <div className="h">納期希望</div><div className="l">{po.expected_at ? parseDbDate(po.expected_at).toLocaleDateString("ja-JP") : "最短"}</div>
                    </div>
                    <div className="company" style={{ flex: 1 }}>
                      <div className="nm">{COMPANY.name}</div>
                      <div>〒{COMPANY.postalCode}　{COMPANY.address}</div>
                      <div>TEL {COMPANY.phone}{COMPANY.fax ? `　FAX ${COMPANY.fax}` : ""}</div>
                      <div className="seal"><Seal size={62} /></div>
                    </div>
                  </div>
                  <p className="lead">下記のとおり発注いたします。</p>
                </>
              )}
              <div className="gt quote" style={{ gridTemplateColumns: "7% 1fr 13%" }}>
                <div className="h">No.</div><div className="h">メーカー ／ 商品名</div><div className="h">数量</div>
                {rows.flatMap((i, k) => {
                  const mk = i.product_id ? manufacturerByProduct.get(i.product_id) : ""
                  const n = pi === 0 ? k + 1 : FIRST_ROWS + (pi - 1) * REST_ROWS + k + 1
                  return [
                    <div className="c" key={i.id + "a"}>{n}</div>,
                    <div className="nmcell" key={i.id + "b"}>
                      <div className="pcode"><span>{mk ? `［${mk}］` : ""}</span><span>{i.note ? noteForPrint(i.note, clinicCodeByName) : ""}</span></div>
                      <div className="nm2">{i.product_name}</div>
                    </div>,
                    <div className="r" key={i.id + "c"}>{i.quantity}</div>,
                  ]
                })}
                {its.length === 0 && <div className="notecell" style={{ minHeight: "12mm" }}>明細なし</div>}
              </div>
              {pi === pages.length - 1 && (
                <>
                  <p style={{ fontSize: 11, margin: "8px 0 0" }}>※ 単価・金額は貴社見積書にてご確認ください。</p>
                  {po.note && (
                    <div className="gt" style={{ gridTemplateColumns: "9% 1fr", marginTop: 8 }}>
                      <div className="remark-h">備<br />考</div>
                      <div className="remark" style={{ minHeight: "14mm" }}>{po.note}</div>
                    </div>
                  )}
                </>
              )}
              <div className="pgno">{pages.length > 1 ? `${pi + 1} / ${pages.length}` : ""}</div>
            </section>
          ))
        })}
      </div>
    </>
  )
}
