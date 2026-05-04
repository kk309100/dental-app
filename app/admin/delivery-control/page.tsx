"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

export default function DeliveryControlPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState("")
  const [deliverQty, setDeliverQty] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: ordersData } = await supabase
      .from("orders")
      .select("*")
      .neq("status", "納品済み")
      .order("created_at", { ascending: false })

    const { data: itemsData } = await supabase.from("order_items").select("*")
    const { data: productsData } = await supabase.from("products").select("*")
    const { data: clinicsData } = await supabase.from("clinics").select("*")

    setOrders(ordersData || [])
    setItems(itemsData || [])
    setProducts(productsData || [])
    setClinics(clinicsData || [])
    setLoading(false)
  }

  function getClinicName(clinicId: string) {
    return clinics.find((c) => c.id === clinicId)?.name || "医院不明"
  }

  function getProduct(productId: string) {
    return products.find((p) => p.id === productId)
  }

  const selectedOrder = orders.find((o) => o.id === selectedOrderId)

  const selectedItems = useMemo(() => {
    return items.filter((i) => i.order_id === selectedOrderId)
  }, [items, selectedOrderId])

  function autoSetDeliverQty() {
    const next: Record<string, number> = {}

    selectedItems.forEach((item) => {
      const product = getProduct(item.product_id)
      const ordered = Number(item.quantity || 0)
      const alreadyDelivered = Number(item.delivered_quantity || 0)
      const remain = Math.max(ordered - alreadyDelivered, 0)
      const stock = Number(product?.stock || 0)

      next[item.id] = Math.min(remain, stock)
    })

    setDeliverQty(next)
  }

  async function saveDelivery() {
    if (!selectedOrder) {
      alert("注文を選択してください")
      return
    }

    let totalDeliveredNow = 0
    let totalBackorder = 0

    for (const item of selectedItems) {
      const product = getProduct(item.product_id)
      const ordered = Number(item.quantity || 0)
      const beforeDelivered = Number(item.delivered_quantity || 0)
      const nowDeliver = Number(deliverQty[item.id] || 0)

      if (nowDeliver < 0) {
        alert("納品数量が不正です")
        return
      }

      const afterDelivered = beforeDelivered + nowDeliver

      if (afterDelivered > ordered) {
        alert(`${item.product_name} の納品数量が注文数を超えています`)
        return
      }

      const backorder = ordered - afterDelivered
      const stock = Number(product?.stock || 0)

      if (nowDeliver > stock) {
        alert(`${item.product_name} の在庫が不足しています`)
        return
      }

      let deliveryStatus = "未処理"

      if (afterDelivered >= ordered) {
        deliveryStatus = "納品済み"
      } else if (afterDelivered > 0) {
        deliveryStatus = "一部納品"
      } else {
        deliveryStatus = "未納"
      }

      await supabase
        .from("order_items")
        .update({
          delivered_quantity: afterDelivered,
          backorder_quantity: backorder,
          delivery_status: deliveryStatus,
        })
        .eq("id", item.id)

      if (product && nowDeliver > 0) {
        await supabase
          .from("products")
          .update({
            stock: stock - nowDeliver,
          })
          .eq("id", product.id)
      }

      totalDeliveredNow += nowDeliver
      totalBackorder += backorder
    }

    let orderStatus = "注文受付"

    if (totalBackorder === 0) {
      orderStatus = "納品済み"
    } else if (totalDeliveredNow > 0) {
      orderStatus = "一部納品"
    } else {
      orderStatus = "入荷待ち"
    }

    await supabase
      .from("orders")
      .update({ status: orderStatus })
      .eq("id", selectedOrder.id)

    alert("納品処理を保存しました")
    setDeliverQty({})
    await fetchData()
  }

  function printPage() {
    window.print()
  }

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  return (
    <main style={pageStyle}>
      <div className="no-print">
        <Link href="/admin">
          <button style={subButton}>管理画面へ戻る</button>
        </Link>

        <h1>納品処理</h1>

        <select
          value={selectedOrderId}
          onChange={(e) => {
            setSelectedOrderId(e.target.value)
            setDeliverQty({})
          }}
          style={inputStyle}
        >
          <option value="">注文を選択してください</option>
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.delivery_number || "納品書番号なし"} /{" "}
              {getClinicName(order.clinic_id)} / {order.status}
            </option>
          ))}
        </select>

        {selectedOrder && (
          <>
            <button onClick={autoSetDeliverQty} style={mainButton}>
              在庫から自動で納品数量を入れる
            </button>

            <section style={cardStyle}>
              <h2>納品数量入力</h2>

              {selectedItems.map((item) => {
                const product = getProduct(item.product_id)
                const ordered = Number(item.quantity || 0)
                const delivered = Number(item.delivered_quantity || 0)
                const remain = Math.max(ordered - delivered, 0)

                return (
                  <div key={item.id} style={rowStyle}>
                    <div>
                      <p style={{ margin: 0, fontWeight: "bold" }}>
                        {item.product_name || product?.name || "商品名なし"}
                      </p>
                      <p style={smallText}>注文数：{ordered}</p>
                      <p style={smallText}>納品済：{delivered}</p>
                      <p style={smallText}>残り：{remain}</p>
                      <p style={smallText}>本部在庫：{product?.stock || 0}</p>
                    </div>

                    <input
                      type="number"
                      min="0"
                      value={deliverQty[item.id] ?? ""}
                      onChange={(e) =>
                        setDeliverQty((prev) => ({
                          ...prev,
                          [item.id]: Number(e.target.value),
                        }))
                      }
                      placeholder="今回納品"
                      style={qtyInput}
                    />
                  </div>
                )
              })}

              <button onClick={saveDelivery} style={mainButton}>
                納品処理を保存
              </button>

              <button onClick={printPage} style={subButton}>
                この納品書を印刷
              </button>
            </section>
          </>
        )}
      </div>

      {selectedOrder && (
        <section className="print-area" style={printSheet}>
          <h1 style={{ textAlign: "center" }}>納 品 書</h1>

          <div style={printHeader}>
            <div>
              <p>納品書番号：{selectedOrder.delivery_number || "-"}</p>
              <h2>{getClinicName(selectedOrder.clinic_id)} 御中</h2>
            </div>

            <div>
              <p>発行日：{new Date().toLocaleDateString()}</p>
              <p style={{ fontWeight: "bold" }}>株式会社 BIODENT</p>
              <p>名古屋市中川区五月通2-37</p>
              <p>TEL：052-526-3223</p>
            </div>
          </div>

          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>No</th>
                <th style={thStyle}>品名</th>
                <th style={thStyle}>今回納品</th>
                <th style={thStyle}>単価</th>
                <th style={thStyle}>金額</th>
              </tr>
            </thead>

            <tbody>
              {selectedItems
                .filter((item) => Number(deliverQty[item.id] || 0) > 0)
                .map((item, index) => (
                  <tr key={item.id}>
                    <td style={tdStyle}>{index + 1}</td>
                    <td style={tdStyle}>{item.product_name}</td>
                    <td style={tdStyle}>{deliverQty[item.id]}</td>
                    <td style={tdStyle}>
                      {Number(item.price || 0).toLocaleString()}
                    </td>
                    <td style={tdStyle}>
                      {(
                        Number(item.price || 0) *
                        Number(deliverQty[item.id] || 0)
                      ).toLocaleString()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          <h2>未納・入荷待ち</h2>

          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>品名</th>
                <th style={thStyle}>未納数</th>
              </tr>
            </thead>

            <tbody>
              {selectedItems
                .map((item) => {
                  const ordered = Number(item.quantity || 0)
                  const already = Number(item.delivered_quantity || 0)
                  const now = Number(deliverQty[item.id] || 0)
                  const backorder = ordered - already - now

                  return { ...item, backorder }
                })
                .filter((item) => item.backorder > 0)
                .map((item) => (
                  <tr key={item.id}>
                    <td style={tdStyle}>{item.product_name}</td>
                    <td style={tdStyle}>{item.backorder}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }

          body {
            margin: 0;
          }

          .print-area {
            display: block !important;
          }
        }
      `}</style>
    </main>
  )
}

const pageStyle: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: 20,
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 16,
  marginTop: 16,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  marginBottom: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  borderBottom: "1px solid #eee",
  padding: "12px 0",
}

const qtyInput: React.CSSProperties = {
  width: 100,
  padding: 10,
  borderRadius: 8,
  border: "1px solid #ddd",
}

const mainButton: React.CSSProperties = {
  width: "100%",
  padding: 14,
  marginBottom: 10,
  borderRadius: 10,
  border: "none",
  background: "#111",
  color: "#fff",
  fontWeight: "bold",
}

const subButton: React.CSSProperties = {
  width: "100%",
  padding: 14,
  marginBottom: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  color: "#111",
  fontWeight: "bold",
}

const smallText: React.CSSProperties = {
  margin: "4px 0",
  fontSize: 12,
  color: "#666",
}

const printSheet: React.CSSProperties = {
  background: "#fff",
  padding: 24,
  marginTop: 24,
}

const printHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 20,
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 12,
  marginBottom: 20,
}

const thStyle: React.CSSProperties = {
  border: "1px solid #000",
  padding: 8,
  background: "#eee",
}

const tdStyle: React.CSSProperties = {
  border: "1px solid #000",
  padding: 8,
}