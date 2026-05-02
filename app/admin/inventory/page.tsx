"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function InventoryPage() {
  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [clinicInventory, setClinicInventory] = useState<any[]>([])
  const [selectedClinic, setSelectedClinic] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: productsData } = await supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true })

    const { data: clinicsData } = await supabase
      .from("clinics")
      .select("*")
      .order("name", { ascending: true })

    const { data: inventoryData } = await supabase
      .from("clinic_inventory")
      .select("*")

    setProducts(productsData || [])
    setClinics(clinicsData || [])
    setClinicInventory(inventoryData || [])
  }

  function getClinicStock(clinicId: string, productId: string) {
    const item = clinicInventory.find(
      (i) => i.clinic_id === clinicId && i.product_id === productId
    )

    return item ? item.stock : 0
  }

  async function updateHeadOfficeStock(productId: string, value: string) {
    const stock = Number(value)

    if (Number.isNaN(stock) || stock < 0) {
      alert("正しい在庫数を入力してください")
      return
    }

    const { error } = await supabase
      .from("products")
      .update({ stock })
      .eq("id", productId)

    if (error) {
      console.error(error)
      alert("本部在庫の更新でエラー")
      return
    }

    fetchData()
  }

  async function updateClinicStock(
    clinicId: string,
    productId: string,
    value: string
  ) {
    const stock = Number(value)

    if (Number.isNaN(stock) || stock < 0) {
      alert("正しい在庫数を入力してください")
      return
    }

    const existing = clinicInventory.find(
      (i) => i.clinic_id === clinicId && i.product_id === productId
    )

    if (existing) {
      const { error } = await supabase
        .from("clinic_inventory")
        .update({ stock })
        .eq("id", existing.id)

      if (error) {
        console.error(error)
        alert("医院在庫の更新でエラー")
        return
      }
    } else {
      const { error } = await supabase
        .from("clinic_inventory")
        .insert([
          {
            clinic_id: clinicId,
            product_id: productId,
            stock,
          },
        ])

      if (error) {
        console.error(error)
        alert("医院在庫の作成でエラー")
        return
      }
    }

    fetchData()
  }

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      <h1>在庫管理</h1>

      <section style={sectionStyle}>
        <h2>本部在庫</h2>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>商品名</th>
              <th style={thStyle}>本部在庫</th>
              <th style={thStyle}>発注基準</th>
              <th style={thStyle}>状態</th>
            </tr>
          </thead>

          <tbody>
            {products.map((product) => {
              const reorderLevel = product.reorder_level ?? 10
              const isLow = product.stock <= reorderLevel

              return (
                <tr key={product.id}>
                  <td style={tdStyle}>{product.name}</td>

                  <td style={tdStyle}>
                    <input
                      type="number"
                      defaultValue={product.stock}
                      onBlur={(e) =>
                        updateHeadOfficeStock(product.id, e.target.value)
                      }
                      style={inputStyle}
                    />
                  </td>

                  <td style={tdStyle}>{reorderLevel}</td>

                  <td style={tdStyle}>
                    {isLow ? (
                      <span style={{ color: "red", fontWeight: "bold" }}>
                        発注必要
                      </span>
                    ) : (
                      <span>OK</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section style={sectionStyle}>
        <h2>医院別在庫</h2>

        <select
          value={selectedClinic}
          onChange={(e) => setSelectedClinic(e.target.value)}
          style={selectStyle}
        >
          <option value="">医院を選択してください</option>
          {clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name}
            </option>
          ))}
        </select>

        {!selectedClinic && <p>医院を選択すると在庫が表示されます。</p>}

        {selectedClinic && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>商品名</th>
                <th style={thStyle}>医院在庫</th>
                <th style={thStyle}>本部在庫</th>
              </tr>
            </thead>

            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td style={tdStyle}>{product.name}</td>

                  <td style={tdStyle}>
                    <input
                      type="number"
                      defaultValue={getClinicStock(selectedClinic, product.id)}
                      onBlur={(e) =>
                        updateClinicStock(
                          selectedClinic,
                          product.id,
                          e.target.value
                        )
                      }
                      style={inputStyle}
                    />
                  </td>

                  <td style={tdStyle}>{product.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}

const sectionStyle: React.CSSProperties = {
  marginBottom: 36,
  background: "#fff",
  padding: 16,
  borderRadius: 12,
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
}

const thStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: 8,
  background: "#f5f5f5",
  textAlign: "left",
}

const tdStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: 8,
}

const inputStyle: React.CSSProperties = {
  width: 90,
  padding: 8,
  borderRadius: 6,
  border: "1px solid #ccc",
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  marginBottom: 16,
  borderRadius: 8,
  border: "1px solid #ccc",
}