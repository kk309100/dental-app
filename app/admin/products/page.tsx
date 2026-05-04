"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"

export default function AdminProductsPage() {
  const [products, setProducts] = useState<any[]>([])
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("すべて")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProducts()
  }, [])

  async function fetchProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true })

    if (error) {
      console.error(error)
      alert("商品データ取得でエラー")
      setLoading(false)
      return
    }

    setProducts(data || [])
    setLoading(false)
  }

  function normalizeText(value: any) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/\s+/g, "")
  }

  const categories = useMemo(() => {
    const list = products
      .map((p) => p.category)
      .filter((c) => c && String(c).trim() !== "")

    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const filteredProducts = useMemo(() => {
    const keyword = normalizeText(search)

    return products.filter((product) => {
      const target = normalizeText(
        `${product.name || ""} ${product.product_code || ""} ${product.manufacturer || ""} ${product.barcode || ""}`
      )

      const matchSearch = !keyword || target.includes(keyword)
      const matchCategory =
        category === "すべて" || product.category === category

      return matchSearch && matchCategory
    })
  }, [products, search, category])

  async function updateProduct(productId: string, field: string, value: any) {
    const { error } = await supabase
      .from("products")
      .update({ [field]: value })
      .eq("id", productId)

    if (error) {
      console.error(error)
      alert("更新でエラーが出ました")
      return
    }

    setProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, [field]: value } : p))
    )
  }

  async function updateNumber(productId: string, field: string, value: string) {
    const numberValue = value === "" ? 0 : Number(value)

    if (Number.isNaN(numberValue)) {
      alert("数字を入力してください")
      return
    }

    await updateProduct(productId, field, numberValue)
  }

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  return (
    <main style={pageStyle}>
      <Link href="/admin">
        <button style={backButton}>管理画面へ戻る</button>
      </Link>

      <h1>商品編集</h1>

      <div style={filterBox}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="商品名・コード・メーカー・バーコードで検索"
          style={inputStyle}
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={inputStyle}
        >
          {categories.map((c: any) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <p style={{ margin: 0, fontSize: 13 }}>
          表示件数：{filteredProducts.length}件 / 全{products.length}件
        </p>
      </div>

      {filteredProducts.map((product) => (
        <div key={product.id} style={cardStyle}>
          <div style={topRow}>
            <div>
              <p style={productName}>{product.name || "商品名なし"}</p>
              <p style={smallText}>商品コード：{product.product_code || "-"}</p>
            </div>

            <label style={activeLabel}>
              <input
                type="checkbox"
                checked={product.is_active !== false}
                onChange={(e) =>
                  updateProduct(product.id, "is_active", e.target.checked)
                }
              />
              表示
            </label>
          </div>

          <div style={gridStyle}>
            <EditInput
              label="商品名"
              value={product.name}
              onBlur={(value: string) =>
                updateProduct(product.id, "name", value)
              }
            />

            <EditInput
              label="商品コード"
              value={product.product_code}
              onBlur={(value: string) =>
                updateProduct(product.id, "product_code", value)
              }
            />

            <EditInput
              label="バーコード"
              value={product.barcode}
              onBlur={(value: string) =>
                updateProduct(product.id, "barcode", value)
              }
            />

            <EditInput
              label="メーカー"
              value={product.manufacturer}
              onBlur={(value: string) =>
                updateProduct(product.id, "manufacturer", value)
              }
            />

            <EditInput
              label="カテゴリー"
              value={product.category}
              onBlur={(value: string) =>
                updateProduct(product.id, "category", value)
              }
            />

            <EditInput
              label="単位"
              value={product.unit}
              onBlur={(value: string) =>
                updateProduct(product.id, "unit", value)
              }
            />

            <EditInput
              label="税抜価格"
              value={product.price}
              type="number"
              onBlur={(value: string) =>
                updateNumber(product.id, "price", value)
              }
            />

            <EditInput
              label="仕入価格"
              value={product.cost}
              type="number"
              onBlur={(value: string) =>
                updateNumber(product.id, "cost", value)
              }
            />

            <EditInput
              label="本部在庫"
              value={product.stock}
              type="number"
              onBlur={(value: string) =>
                updateNumber(product.id, "stock", value)
              }
            />

            <EditInput
              label="発注基準"
              value={product.reorder_level}
              type="number"
              onBlur={(value: string) =>
                updateNumber(product.id, "reorder_level", value)
              }
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>画像URL</label>
            <input
              defaultValue={product.image_url || ""}
              onBlur={(e) =>
                updateProduct(product.id, "image_url", e.target.value)
              }
              style={inputStyle}
              placeholder="https://..."
            />

            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                style={imagePreview}
              />
            ) : (
              <div style={noImage}>NO IMAGE</div>
            )}
          </div>
        </div>
      ))}
    </main>
  )
}

function EditInput({
  label,
  value,
  onBlur,
  type = "text",
}: {
  label: string
  value: any
  onBlur: any
  type?: string
}) {
  const [localValue, setLocalValue] = useState(value ?? "")

  useEffect(() => {
    setLocalValue(value ?? "")
  }, [value])

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => onBlur(localValue)}
        style={inputStyle}
      />
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  maxWidth: 900,
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

const filterBox: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 14,
  marginBottom: 16,
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 16,
  marginBottom: 16,
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
}

const topRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
  marginBottom: 12,
}

const productName: React.CSSProperties = {
  margin: 0,
  fontWeight: "bold",
  fontSize: 17,
}

const smallText: React.CSSProperties = {
  margin: "4px 0",
  fontSize: 12,
  color: "#666",
}

const activeLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
  fontWeight: "bold",
}

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: "bold",
  marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid #ddd",
  boxSizing: "border-box",
}

const imagePreview: React.CSSProperties = {
  width: 140,
  height: 100,
  objectFit: "cover",
  borderRadius: 8,
  marginTop: 8,
  border: "1px solid #eee",
}

const noImage: React.CSSProperties = {
  width: 140,
  height: 70,
  borderRadius: 8,
  marginTop: 8,
  background: "#f1f5f9",
  color: "#94a3b8",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
}