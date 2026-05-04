"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

export default function ReceivingPage() {
  const [products, setProducts] = useState<any[]>([])
  const [receipts, setReceipts] = useState<any[]>([])
  const [search, setSearch] = useState("")
  const [selectedProductId, setSelectedProductId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [memo, setMemo] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: productsData } = await supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true })

    const { data: receiptsData } = await supabase
      .from("stock_receipts")
      .select("*")
      .order("created_at", { ascending: false })

    setProducts(productsData || [])
    setReceipts(receiptsData || [])
    setLoading(false)
  }

  function normalizeText(value: any) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/\s+/g, "")
  }

  const filteredProducts = useMemo(() => {
    const keyword = normalizeText(search)

    return products.filter((product) => {
      const target = normalizeText(
        `${product.name || ""} ${product.product_code || ""} ${product.manufacturer || ""} ${product.barcode || ""}`
      )

      return !keyword || target.includes(keyword)
    })
  }, [products, search])

  function getProduct(productId: string) {
    return products.find((p) => p.id === productId)
  }

  async function receiveStock() {
    if (!selectedProductId) {
      alert("商品を選択してください")
      return
    }

    const qty = Number(quantity)

    if (Number.isNaN(qty) || qty <= 0) {
      alert("入荷数量を正しく入力してください")
      return
    }

    const product = getProduct(selectedProductId)

    if (!product) {
      alert("商品が見つかりません")
      return
    }

    const newStock = Number(product.stock || 0) + qty

    const { error: updateError } = await supabase
      .from("products")
      .update({ stock: newStock })
      .eq("id", selectedProductId)

    if (updateError) {
      console.error(updateError)
      alert("在庫更新でエラーが出ました")
      return
    }

    const { error: receiptError } = await supabase.from("stock_receipts").insert([
      {
        product_id: selectedProductId,
        quantity: qty,
        memo,
      },
    ])

    if (receiptError) {
      console.error(receiptError)
      alert("入荷履歴の保存でエラーが出ました")
      return
    }

    alert("入荷処理が完了しました")

    setSelectedProductId("")
    setQuantity("")
    setMemo("")
    setSearch("")
    fetchData()
  }

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  const selectedProduct = getProduct(selectedProductId)

  return (
    <main style={pageStyle}>
      <Link href="/admin">
        <button style={backButton}>管理画面へ戻る</button>
      </Link>

      <h1>入荷処理</h1>

      <section style={cardStyle}>
        <h2>商品を選択</h2>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="商品名・コード・メーカーで検索"
          style={inputStyle}
        />

        <select
          value={selectedProductId}
          onChange={(e) => setSelectedProductId(e.target.value)}
          style={inputStyle}
        >
          <option value="">商品を選択してください</option>

          {filteredProducts.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} / {product.manufacturer || "-"} / 在庫:{product.stock || 0}
            </option>
          ))}
        </select>

        {selectedProduct && (
          <div style={productBox}>
            <p style={{ fontWeight: "bold" }}>{selectedProduct.name}</p>
            <p>商品コード：{selectedProduct.product_code || "-"}</p>
            <p>メーカー：{selectedProduct.manufacturer || "-"}</p>
            <p>現在庫：{selectedProduct.stock || 0}</p>
          </div>
        )}

        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="入荷数量"
          style={inputStyle}
        />

        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="メモ 例：〇〇メーカー入荷、伝票番号など"
          style={textareaStyle}
        />

        <button onClick={receiveStock} style={mainButton}>
          入荷して本部在庫を増やす
        </button>
      </section>

      <section style={cardStyle}>
        <h2>入荷履歴</h2>

        {receipts.length === 0 && <p>入荷履歴はありません。</p>}

        {receipts.map((receipt) => {
          const product = getProduct(receipt.product_id)

          return (
            <div key={receipt.id} style={historyRow}>
              <div>
                <p style={{ margin: 0, fontWeight: "bold" }}>
                  {product?.name || "商品名不明"}
                </p>
                <p style={smallText}>
                  {new Date(receipt.created_at).toLocaleString()}
                </p>
                <p style={smallText}>メモ：{receipt.memo || "-"}</p>
              </div>

              <strong>+{receipt.quantity}</strong>
            </div>
          )
        })}
      </section>
    </main>
  )
}

const pageStyle: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: 20,
}

const backButton: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  marginBottom: 16,
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 16,
  marginBottom: 18,
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  marginBottom: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  boxSizing: "border-box",
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 80,
  padding: 12,
  marginBottom: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  boxSizing: "border-box",
}

const productBox: React.CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #ddd",
  borderRadius: 10,
  padding: 12,
  marginBottom: 10,
}

const mainButton: React.CSSProperties = {
  width: "100%",
  padding: 14,
  borderRadius: 10,
  border: "none",
  background: "#111",
  color: "#fff",
  fontWeight: "bold",
  fontSize: 16,
}

const historyRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid #eee",
  padding: "12px 0",
  gap: 12,
}

const smallText: React.CSSProperties = {
  margin: "4px 0",
  fontSize: 12,
  color: "#666",
}