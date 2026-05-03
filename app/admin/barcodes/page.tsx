"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Barcode from "react-barcode"

export default function BarcodePage() {
  const [products, setProducts] = useState<any[]>([])

  useEffect(() => {
    fetchProducts()
  }, [])

  async function fetchProducts() {
    const { data } = await supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true })

    setProducts(data || [])
  }

  return (
    <main style={{ padding: 20 }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>
        バーコード一覧
      </h1>

      <button
        onClick={() => window.print()}
        style={{
          marginBottom: 20,
          padding: 10,
          background: "#111",
          color: "#fff",
          border: "none",
          borderRadius: 8,
        }}
      >
        印刷する
      </button>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {products.map((p) => (
          <div
            key={p.id}
            style={{
              width: 180,
              border: "1px solid #ddd",
              padding: 10,
              borderRadius: 8,
              background: "#fff",
            }}
          >
            <p style={{ fontSize: 12, marginBottom: 6 }}>
              {p.name}
            </p>

            {p.barcode && (
              <Barcode
                value={p.barcode}
                width={1.5}
                height={50}
                fontSize={10}
              />
            )}
          </div>
        ))}
      </div>
    </main>
  )
}