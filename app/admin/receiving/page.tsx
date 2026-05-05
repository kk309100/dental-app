"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, ymd } from "@/lib/invoice"

type Product = {
  id: string
  name: string
  product_code: string | null
  manufacturer: string | null
  stock: number | null
  cost: number | null
  barcode: string | null
}
type Supplier = { id: string; name: string; maker_name: string | null }

type Row = {
  productName: string         // 商品名（PDF由来 or 手入力）
  supplierJan: string         // PDF由来
  supplierCode: string        // PDF由来
  packSize: string            // 「20枚入」等
  quantity: string            // 数量（在庫加算数 = この数だけ stock 増える）
  unitPrice: string           // 単価（1個あたり）
  memo: string
  manufacturer: string        // 新規作成時用
}

const newRow = (): Row => ({
  productName: "", supplierJan: "", supplierCode: "",
  packSize: "", quantity: "", unitPrice: "",
  memo: "", manufacturer: "",
})

const INITIAL_ROWS = 10

export default function ReceivingPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [recent, setRecent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [supplierId, setSupplierId] = useState("")
  const [date, setDate] = useState(ymd(new Date()))
  const [updateCost, setUpdateCost] = useState(true)

  const [rows, setRows] = useState<Row[]>(Array.from({ length: INITIAL_ROWS }, newRow))

  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState("")
  const [parsedMeta, setParsedMeta] = useState<{ supplier_name?: string; invoice_number?: string; invoice_date?: string; total?: number } | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [logs, setLogs] = useState<string[]>([])
  // 仕入登録後の「これで出荷可能になった注文」結果
  const [postReceiveResult, setPostReceiveResult] = useState<null | {
    receivedRows: number
    totalAmount: number
    nowShippable: { orderId: string; clinicId: string; clinicName: string; deliveryNumber: string; itemCount: number; totalPrice: number }[]
    partiallyImpacted: number  // 入庫商品を含むがまだ出荷不可な注文数
  }>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [p, s, r] = await Promise.all([
      supabase.from("products").select("id,name,product_code,manufacturer,stock,cost,barcode").limit(50000),
      supabase.from("suppliers").select("id,name,maker_name").order("name").limit(50000),
      supabase.from("stock_receipts").select("*").order("created_at", { ascending: false }).limit(20),
    ])
    setProducts((p.data as Product[]) || [])
    setSuppliers((s.data as Supplier[]) || [])
    setRecent(r.data || [])
    setLoading(false)
  }

  function updateRow(i: number, partial: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...partial } : r))
  }
  function addRow() { setRows((prev) => [...prev, newRow()]) }
  function removeRow(i: number) {
    setRows((prev) => {
      const next = prev.filter((_, idx) => idx !== i)
      return next.length === 0 ? [newRow()] : next
    })
  }
  function clearAll() {
    if (!confirm("入力をすべてクリアしますか？")) return
    setRows(Array.from({ length: INITIAL_ROWS }, newRow))
    setLogs([])
    setParsedMeta(null)
    setPdfFile(null)
    setParseError("")
    setPostReceiveResult(null)
  }

  async function uploadAndParse(file?: File) {
    const target = file || pdfFile
    if (!target) { setParseError("PDF を選択してください"); return }
    if (file) setPdfFile(file)
    setParsing(true)
    setParseError("")
    setParsedMeta(null)
    try {
      const buf = await target.arrayBuffer()
      const base64 = Buffer.from(buf).toString("base64")
      const r = await fetch("/api/parse-receiving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: base64 }),
      })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.error || "解析失敗")
      }
      const { data } = await r.json()
      setParsedMeta({ supplier_name: data.supplier_name, invoice_number: data.invoice_number, invoice_date: data.invoice_date, total: data.total })

      if (data.invoice_date) setDate(data.invoice_date)
      if (!supplierId && data.supplier_name) {
        const matched = suppliers.find((s) => data.supplier_name.includes(s.name) || s.name.includes(data.supplier_name.split(/\s+/)[0]))
        if (matched) setSupplierId(matched.id)
      }

      const newRows: Row[] = data.items.map((it: any) => ({
        productName: it.supplier_product_name || "",
        supplierJan: it.supplier_jan || "",
        supplierCode: it.supplier_product_code || "",
        packSize: it.pack_size || "",
        quantity: String(it.quantity || ""),
        unitPrice: String(it.unit_price || ""),
        memo: "",
        manufacturer: "",
      }))
      const padded = newRows.length >= INITIAL_ROWS ? newRows : [...newRows, ...Array.from({ length: INITIAL_ROWS - newRows.length }, newRow)]
      setRows(padded)
    } catch (e) {
      setParseError((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  // 商品マスタ検索: JAN → product_code → name
  function findProduct(row: Row): Product | undefined {
    if (row.supplierJan) {
      const m = products.find((p) => p.barcode === row.supplierJan)
      if (m) return m
    }
    if (row.supplierCode) {
      const m = products.find((p) => p.product_code === row.supplierCode)
      if (m) return m
    }
    if (row.productName) {
      return products.find((p) => p.name === row.productName.trim())
    }
    return undefined
  }

  const validRows = rows.filter((r) => r.productName.trim() && Number(r.quantity) > 0)
  const totalAmount = validRows.reduce((s, r) => s + (Number(r.unitPrice) || 0) * Number(r.quantity), 0)

  async function submitAll() {
    if (validRows.length === 0) { alert("有効な行がありません"); return }
    if (!confirm(`${validRows.length}行を仕入登録します。\n合計仕入額: ${fmtYen(totalAmount)}\n\n商品マスタに無い商品は自動で新規登録されます。\nよろしいですか？`)) return

    setSubmitting(true)
    setPostReceiveResult(null)  // 前回の結果をクリア
    setLogs([])
    setProgress({ done: 0, total: validRows.length })
    const newLogs: string[] = []
    const stockedProductIds: string[] = []  // 入庫した商品IDをループ内で蓄積

    let invoiceId: string | null = null
    if (parsedMeta) {
      const { data } = await supabase.from("supplier_invoices").insert({
        supplier_id: supplierId || null,
        invoice_date: date,
        invoice_number: parsedMeta.invoice_number || null,
        total_amount: totalAmount,
        pdf_filename: pdfFile?.name || null,
        parsed_data: parsedMeta,
        status: "completed",
        completed_at: new Date().toISOString(),
      }).select().single()
      invoiceId = data?.id || null
    }

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      try {
        const qty = Number(row.quantity)
        const price = row.unitPrice === "" ? null : Number(row.unitPrice)

        // 商品検索 or 新規作成
        let product = findProduct(row)
        if (!product) {
          // 新規作成
          const supplierName = suppliers.find((s) => s.id === supplierId)?.name || ""
          const { data: newP, error: cpe } = await supabase.from("products").insert({
            name: row.productName.trim(),
            product_code: row.supplierCode || null,
            manufacturer: row.manufacturer || supplierName || null,
            barcode: row.supplierJan || null,
            stock: 0,
            reorder_level: 10,
            cost: price,
            price: 0,
            is_active: true,
          }).select().single()
          if (cpe) throw new Error("商品新規作成失敗: " + cpe.message)
          product = newP as Product
          newLogs.push(`+ 新規商品作成: ${product.name}`)
          setProducts((prev) => [...prev, product!])
        }

        // 在庫 + cost 更新（数量 = 在庫加算）
        const before = Number(product.stock || 0)
        const after = before + qty
        const productUpdate: { stock: number; cost?: number } = { stock: after }
        if (price !== null && updateCost) productUpdate.cost = price
        const { error: pe } = await supabase.from("products").update(productUpdate).eq("id", product.id)
        if (pe) throw new Error(pe.message)

        const memoStr = [
          row.memo,
          parsedMeta?.invoice_number ? `伝票:${parsedMeta.invoice_number}` : "",
        ].filter(Boolean).join(" / ")
        const { error: re } = await supabase.from("stock_receipts").insert({
          product_id: product.id,
          quantity: qty,
          memo: memoStr || null,
          supplier_id: supplierId || null,
          unit_price: price,
        })
        if (re) throw new Error(re.message)

        // stock_movements にも記録（テーブル無い場合スキップ）
        try {
          await supabase.from("stock_movements").insert({
            product_id: product.id,
            movement_type: "入庫",
            quantity: qty,
            before_stock: before,
            after_stock: after,
            ref_type: "stock_receipt",
            reason: parsedMeta?.invoice_number ? `仕入伝票 ${parsedMeta.invoice_number}` : "仕入入力",
          })
        } catch { /* スキップ */ }

        newLogs.push(`✓ ${product.name} +${qty}`)
        stockedProductIds.push(product.id)  // 後の「出荷可能注文」判定で使用
      } catch (e) {
        newLogs.push(`✗ ${row.productName}: ${(e as Error).message}`)
      }
      setProgress({ done: i + 1, total: validRows.length })
      setLogs([...newLogs])
    }

    setSubmitting(false)
    if (newLogs.every((l) => l.startsWith("✓") || l.startsWith("+"))) {
      setRows(Array.from({ length: INITIAL_ROWS }, newRow))
      setParsedMeta(null)
      setPdfFile(null)
    }
    fetchData()

    // 入庫した商品で「出荷可能になった注文」を全件出力
    // 1) この入庫商品を含む未納品注文を取得
    // 2) その注文の全 items について現在庫を確認
    // 3) 全 items の在庫が足りる注文だけ "出荷可能" として通知
    let nowShippableList: typeof postReceiveResult extends infer T ? (T extends { nowShippable: infer L } ? L : never) : never = [] as any
    let partiallyImpacted = 0
    if (stockedProductIds.length > 0) {
      try {
        // 未納品注文（表記ゆれ「納品済」も除外。完了系を除いた active のみ）
        const { data: allOrders } = await supabase
          .from("orders")
          .select("id,clinic_id,status,total_price,delivery_number")
          .limit(50000)
        const pendingOrders = (allOrders || []).filter(
          (o: any) => !["納品済み", "納品済", "キャンセル", "取消"].includes(o.status)
        )
        const pendingOrderIds = pendingOrders.map((o: any) => o.id)

        if (pendingOrderIds.length > 0) {
          // 入庫商品を含む注文だけに絞り込み
          const { data: hitItems } = await supabase
            .from("order_items")
            .select("order_id,product_id,quantity")
            .in("order_id", pendingOrderIds)
            .in("product_id", stockedProductIds)
            .limit(50000)
          const affectedOrderIds = Array.from(new Set((hitItems || []).map((it: any) => it.order_id)))

          if (affectedOrderIds.length > 0) {
            // 全 items を取得（影響注文の全行を見て出荷可否判定）
            const { data: allItemsForAffected } = await supabase
              .from("order_items")
              .select("id,order_id,product_id,quantity")
              .in("order_id", affectedOrderIds)
              .limit(50000)

            // 必要な全 product_id の現在庫を取得
            const allProductIds = Array.from(new Set((allItemsForAffected || []).map((it: any) => it.product_id).filter(Boolean)))
            const { data: prodStocks } = await supabase
              .from("products")
              .select("id,stock")
              .in("id", allProductIds)
            const stockMap = new Map<string, number>((prodStocks || []).map((p: any) => [p.id, Number(p.stock || 0)]))

            // 医院名取得
            const clinicIds = Array.from(new Set(pendingOrders.filter((o: any) => affectedOrderIds.includes(o.id)).map((o: any) => o.clinic_id)))
            const { data: cls } = await supabase.from("clinics").select("id,name").in("id", clinicIds)
            const clinicMap = new Map<string, string>((cls || []).map((c: any) => [c.id, c.name]))

            // 注文ごとに「全 items の在庫充足？」判定
            const itemsByOrder = new Map<string, any[]>()
            ;(allItemsForAffected || []).forEach((it: any) => {
              if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, [])
              itemsByOrder.get(it.order_id)!.push(it)
            })

            const shippable: any[] = []
            let partial = 0
            for (const oid of affectedOrderIds) {
              const its = itemsByOrder.get(oid) || []
              const allOk = its.every(it => Number(stockMap.get(it.product_id) || 0) >= Number(it.quantity || 0))
              const ord = pendingOrders.find((o: any) => o.id === oid)
              if (!ord) continue
              if (allOk) {
                shippable.push({
                  orderId: oid,
                  clinicId: ord.clinic_id,
                  clinicName: clinicMap.get(ord.clinic_id) || "(医院不明)",
                  deliveryNumber: ord.delivery_number || oid.slice(0, 8),
                  itemCount: its.length,
                  totalPrice: Number(ord.total_price || 0),
                })
              } else {
                partial++
              }
            }
            nowShippableList = shippable
            partiallyImpacted = partial
          }
        }
      } catch { /* スキップ */ }
    }

    setPostReceiveResult({
      receivedRows: validRows.length,
      totalAmount,
      nowShippable: nowShippableList,
      partiallyImpacted,
    })
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-3">
      {/* タイトル + PDF読込ボタン（タイトル直右に） */}
      <div className="flex items-center flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-900">
          📦 仕入納品（仕入先からの入荷登録）
          <span className="ml-2 text-xs font-normal text-gray-400">手打ち or PDF読込 ・ 商品マスタは自動更新</span>
        </h1>
        <label
          htmlFor="pdf-upload"
          className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors " + (parsing ? "bg-gray-300 text-gray-600 cursor-wait" : "bg-blue-600 text-white hover:bg-blue-700")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {parsing ? "AI解析中…" : "📄 PDFから読込"}
        </label>
        <input
          id="pdf-upload"
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) uploadAndParse(f)
            // ファイル選択をリセット（同じファイル再選択可能に）
            e.target.value = ""
          }}
          className="hidden"
          disabled={parsing}
        />
      </div>

      {/* 解析結果バナー（あるときだけ） */}
      {parseError && (
        <div className="bg-red-50 text-red-700 text-xs p-2 rounded" style={{ border: "1px solid #fca5a5" }}>
          ⚠ PDF解析失敗: {parseError}
        </div>
      )}
      {parsedMeta && (
        <div className="bg-blue-50 text-blue-800 text-xs p-2 rounded" style={{ border: "1px solid #c7d2fe" }}>
          ✅ <strong>{pdfFile?.name}</strong> 解析成功: {parsedMeta.supplier_name || "—"} / No.{parsedMeta.invoice_number || "—"} / 合計 {parsedMeta.total ? fmtYen(parsedMeta.total) : "—"} → 下の表に流し込み済み
        </div>
      )}

      {/* 仕入登録後の「これで出荷可能になった注文」自動通知 */}
      {postReceiveResult && (
        <div className="bg-emerald-50 rounded-lg p-3" style={{ border: "2px solid #10b981" }}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-emerald-900">
              ✅ 仕入登録完了 ({postReceiveResult.receivedRows}行 / {fmtYen(postReceiveResult.totalAmount)})
            </h2>
            <button
              onClick={() => setPostReceiveResult(null)}
              className="text-xs text-gray-500 hover:text-gray-700">✕ 閉じる</button>
          </div>

          {postReceiveResult.nowShippable.length === 0 && postReceiveResult.partiallyImpacted === 0 && (
            <p className="text-xs text-emerald-800">
              入庫商品を待っていた未納品注文はありませんでした。
            </p>
          )}

          {postReceiveResult.nowShippable.length > 0 && (
            <div>
              <p className="text-xs font-bold text-emerald-900 mb-1">
                🚚 これで出荷可能になった注文 <span className="text-base">{postReceiveResult.nowShippable.length}件</span>
              </p>
              <div className="bg-white rounded p-2 mb-2 max-h-48 overflow-auto" style={{ border: "1px solid #d1fae5" }}>
                {postReceiveResult.nowShippable.map((o) => (
                  <div key={o.orderId} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-100 last:border-0">
                    <span>
                      <strong>{o.clinicName}</strong>
                      <span className="ml-2 text-gray-500 font-mono text-[10px]">{o.deliveryNumber}</span>
                      <span className="ml-2 text-gray-400 text-[10px]">{o.itemCount}品</span>
                    </span>
                    <span className="font-bold tabular-nums">{fmtYen(o.totalPrice)}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const ids = postReceiveResult.nowShippable.map(o => o.orderId).join(",")
                  window.location.href = `/admin/shipping?orders=${ids}`
                }}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700 mr-2"
              >
                → 出荷準備へ（{postReceiveResult.nowShippable.length}件を選択済みで開く）
              </button>
            </div>
          )}

          {postReceiveResult.partiallyImpacted > 0 && (
            <p className="text-[11px] text-amber-700 mt-2">
              ⚠ 入庫商品を含むがまだ他の品が在庫不足の注文: {postReceiveResult.partiallyImpacted}件（追加入荷待ち）
            </p>
          )}
        </div>
      )}

      {/* 共通設定 */}
      <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5 font-bold">仕入先</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
              <option value="">— 仕入先を選択 —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.maker_name ? ` (${s.maker_name})` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5 font-bold">入荷日</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
          </div>
        </div>
      </div>

      {/* 入力表 */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 bg-gray-100">
            <tr className="text-[10px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-1.5 py-1.5 text-center w-8">#</th>
              <th className="px-1.5 py-1.5 text-left">商品名</th>
              <th className="px-1.5 py-1.5 text-left w-32">JAN / 商品コード</th>
              <th className="px-1.5 py-1.5 text-right w-16">数量</th>
              <th className="px-1.5 py-1.5 text-right w-20">単価</th>
              <th className="px-1.5 py-1.5 text-right w-24">小計</th>
              <th className="px-1.5 py-1.5 text-center w-12" title="1パックを N個に分割（小計固定）">分割</th>
              <th className="px-1.5 py-1.5 text-left w-28">メモ</th>
              <th className="px-1.5 py-1.5 text-center w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const qty = Number(row.quantity || 0)
              const price = Number(row.unitPrice || 0)
              const subtotal = price * qty
              const existing = findProduct(row)
              const isPdfRow = !!(row.supplierJan || row.supplierCode)

              // 小計を直接編集 → 単価 = 小計 / 数量
              const onSubtotalChange = (v: string) => {
                const newSub = Number(v.replace(/[^\d.]/g, "")) || 0
                if (qty > 0) {
                  const newPrice = newSub / qty
                  updateRow(i, { unitPrice: String(Math.round(newPrice * 100) / 100) })
                }
              }

              // ばらす: 1パックを N個に分割 → 数量×N、単価÷N、小計同じ
              const split = () => {
                if (qty <= 0) { alert("先に数量を入力してください"); return }
                const factor = Number(prompt(`「${row.productName}」を何個に分割しますか？\n例: 1パック → 10個 で在庫管理したい場合は 10\n（小計は変わらず、単価が ${fmtYen(price)} → ${fmtYen(price / 10)} のように調整されます）`, "10"))
                if (!factor || factor <= 0) return
                updateRow(i, {
                  quantity: String(qty * factor),
                  unitPrice: String(Math.round((price / factor) * 100) / 100),
                })
              }

              return (
                <tr key={i} className={"border-b border-gray-100 " + (existing ? "bg-emerald-50/30" : isPdfRow && row.productName ? "bg-yellow-50/40" : "")}>
                  <td className="px-1.5 py-0.5 text-center text-gray-400">{i + 1}</td>
                  <td className="px-1.5 py-0.5">
                    <input
                      list="products-list"
                      value={row.productName}
                      onChange={(e) => updateRow(i, { productName: e.target.value })}
                      placeholder="商品名"
                      className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px]"
                    />
                    {row.packSize && <div className="text-[9px] text-gray-400 mt-0.5">入数: {row.packSize}</div>}
                    {row.productName && !existing && <div className="text-[9px] text-yellow-700 mt-0.5">⚡ 新規商品として登録されます</div>}
                  </td>
                  <td className="px-1.5 py-0.5 text-[10px] text-gray-500">
                    {row.supplierJan && <div>{row.supplierJan}</div>}
                    {row.supplierCode && <div>{row.supplierCode}</div>}
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input type="number" value={row.quantity} onChange={(e) => updateRow(i, { quantity: e.target.value })} className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-[11px]" title="数量 = 在庫に加算される数" />
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.unitPrice ? Number(row.unitPrice).toLocaleString("ja-JP", { maximumFractionDigits: 2 }) : ""}
                      onChange={(e) => updateRow(i, { unitPrice: e.target.value.replace(/[^\d.]/g, "") })}
                      placeholder="¥"
                      className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-[11px]"
                    />
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={subtotal > 0 ? Math.round(subtotal).toLocaleString("ja-JP") : ""}
                      onChange={(e) => onSubtotalChange(e.target.value)}
                      placeholder="¥"
                      className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-[11px] font-bold"
                      title="小計を編集すると単価が自動逆算（数量固定）"
                    />
                  </td>
                  <td className="px-1.5 py-0.5 text-center">
                    <button onClick={split} disabled={qty <= 0} className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 disabled:opacity-30" title="1パックを複数個に分割（小計固定）">📦 分割</button>
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input value={row.memo} onChange={(e) => updateRow(i, { memo: e.target.value })} placeholder="伝票No等" className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px]" />
                  </td>
                  <td className="px-1.5 py-0.5 text-center">
                    <button onClick={() => removeRow(i)} className="text-red-500 hover:text-red-700 text-base leading-none">×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 sticky bottom-0">
            <tr className="border-t-2 border-gray-300">
              <td colSpan={5} className="px-2 py-2 text-right text-xs font-bold text-gray-700">合計</td>
              <td className="px-2 py-2 text-right text-base font-bold text-gray-900">{fmtYen(totalAmount)}</td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id="products-list">
        {products.map((p) => <option key={p.id} value={p.name}>{p.product_code || ""} {p.manufacturer || ""}</option>)}
      </datalist>

      {/* 凡例 + アクション */}
      <div className="bg-white rounded-lg p-3 sticky bottom-0" style={{ border: "1px solid #e8eaed" }}>
        <div className="flex items-center gap-3 text-[11px] text-gray-600 mb-2 flex-wrap">
          <span><span className="inline-block w-3 h-3 bg-emerald-50 border border-emerald-200 mr-1 align-middle"></span>商品マスタ既存</span>
          <span><span className="inline-block w-3 h-3 bg-yellow-50 border border-yellow-200 mr-1 align-middle"></span>新規作成される</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={addRow} className="px-3 py-1.5 border border-gray-200 rounded text-xs">＋ 行を追加</button>
          <button onClick={clearAll} className="px-3 py-1.5 border border-gray-200 rounded text-xs text-gray-500">クリア</button>
          <label className="flex items-center gap-1 text-xs text-gray-600 ml-2">
            <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
            商品マスタの仕入価格も更新
          </label>
          <div className="flex-1 text-xs text-gray-500 text-right">
            有効: <strong className="text-gray-900">{validRows.length}行</strong> / 合計: <strong className="text-gray-900">{fmtYen(totalAmount)}</strong>
          </div>
          <button onClick={submitAll} disabled={submitting || validRows.length === 0} className="px-6 py-3 rounded-lg bg-gray-900 text-white font-bold text-sm disabled:opacity-50">
            {submitting ? `登録中… ${progress.done}/${progress.total}` : `${validRows.length}行 仕入登録`}
          </button>
        </div>
      </div>

      {logs.length > 0 && (
        <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
          <p className="text-xs font-bold text-gray-500 mb-2">登録結果</p>
          <div className="space-y-1 max-h-48 overflow-auto text-[11px]">
            {logs.map((l, i) => (
              <div key={i} className={l.startsWith("✓") ? "text-emerald-700" : l.startsWith("+") ? "text-blue-700" : "text-red-700"}>{l}</div>
            ))}
          </div>
        </div>
      )}

      <details className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <summary className="text-xs font-bold text-gray-500 cursor-pointer">直近の入荷履歴 (最新20件)</summary>
        <div className="mt-2 space-y-1 max-h-64 overflow-auto">
          {recent.map((rc) => {
            const product = products.find((p) => p.id === rc.product_id)
            const supplier = suppliers.find((s) => s.id === rc.supplier_id)
            return (
              <div key={rc.id} className="flex items-center justify-between py-1.5 px-2 text-[11px] border-b border-gray-100">
                <div className="flex-1 min-w-0">
                  <span className="font-semibold">{product?.name || "—"}</span>
                  <span className="text-gray-400 ml-2">{new Date(rc.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {supplier && <span className="text-gray-400 ml-2">/ {supplier.name}</span>}
                </div>
                <div className="flex items-center gap-3 text-right shrink-0">
                  {rc.unit_price && <span className="text-gray-500">@{fmtYen(rc.unit_price)}</span>}
                  <span className="font-bold w-12">+{rc.quantity}</span>
                </div>
              </div>
            )
          })}
        </div>
      </details>
    </div>
  )
}
