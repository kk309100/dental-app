"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function DeliveryPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: ordersData } = await supabase.from("orders").select("*")
    const { data: itemsData } = await supabase.from("order_items").select("*")
    const { data: productsData } = await supabase.from("products").select("*")
    const { data: clinicsData } = await supabase.from("clinics").select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
    setProducts(productsData || [])
    setClinics(clinicsData || [])
  }

  function getClinicName(id: string) {
    return clinics.find((c) => c.id === id)?.name || ""
  }

  function getProduct(id: string) {
    return products.find((p) => p.id === id)
  }

  function getItems(orderId: string) {
    return orderItems.filter((i) => i.order_id === orderId)
  }

  function formatNumber(num: number) {
    return Number(num || 0).toLocaleString()
  }

  // 🔥 納品済みにする
  async function markAsDelivered() {
    for (const order of orders) {
      await supabase
        .from("orders")
        .update({ status: "納品済み" })
        .eq("id", order.id)
    }
  }

  // 🔥 印刷処理
  async function printPage() {
    await markAsDelivered()
    window.print()
    setTimeout(() => fetchData(), 500)
  }

  function Sheet({ order, isCopy = false }: any) {
    const rawItems = getItems(order.id)

    // 🔥 同じ商品まとめる
    const items = Object.values(
      rawItems.reduce((acc: any, item: any) => {
        const key = item.product_id

        if (!acc[key]) {
          acc[key] = { ...item }
        } else {
          acc[key].quantity += item.quantity
        }

        return acc
      }, {})
    )

    const subtotal = Number(order.total_price || 0)
    const tax = Math.floor(subtotal * 0.1)
    const total = subtotal + tax

    return (
      <div className="sheet">
        <div className="header">
          <div>
            <div className="small">納品書番号：{order.delivery_number}</div>
            <div className="clinic">{getClinicName(order.clinic_id)} 御中</div>
          </div>

          <div className="title">
            納　品　書{isCopy ? "（控）" : ""}
          </div>

          <div className="company">
            <div>発行日：{new Date(order.created_at).toLocaleDateString()}</div>
            <div className="company-name">株式会社 BIODENT</div>
          </div>
        </div>

        <table className="detail">
          <thead>
            <tr>
              <th>No</th>
              <th>品名</th>
              <th>数量</th>
              <th>単価</th>
              <th>金額</th>
            </tr>
          </thead>

          <tbody>
            {Array.from({ length: 10 }).map((_, i) => {
              const item: any = items[i]
              const product = item ? getProduct(item.product_id) : null

              return (
                <tr key={i}>
                  <td className="center">{i + 1}</td>
                  <td>{product?.name || ""}</td>
                  <td className="center">{item?.quantity || ""}</td>
                  <td className="right">{item ? formatNumber(item.price) : ""}</td>
                  <td className="right bold">
                    {item ? formatNumber(item.price * item.quantity) : ""}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="bottom">
          <div className="note">備考：</div>

          <div className="total-box">
            <div className="total-row">
              <span>小計</span>
              <span>{formatNumber(subtotal)} 円</span>
            </div>
            <div className="total-row">
              <span>消費税</span>
              <span>{formatNumber(tax)} 円</span>
            </div>
            <div className="total-row grand">
              <span>合計</span>
              <span>{formatNumber(total)} 円</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <main className="page">
      <button className="no-print" onClick={printPage}>
        印刷（完了すると一覧から消えます）
      </button>

      {/* 🔥 納品済みは表示しない */}
      {orders
        .filter((o) => o.status !== "納品済み")
        .map((order) => (
          <div key={order.id} className="a4">
            <div className="half">
              <Sheet order={order} />
            </div>
            <div className="half">
              <Sheet order={order} isCopy />
            </div>
          </div>
        ))}

      <style jsx global>{`
        body { margin: 0; }
        .page { padding: 20px; background: #eee; }

        .a4 {
          width: 210mm;
          height: 297mm;
          margin: auto;
          background: white;
          display: flex;
          flex-direction: column;
        }

        .half {
          height: 50%;
          padding: 8mm 10mm;
          box-sizing: border-box;
        }

        .sheet { font-size: 10px; }

        .header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 4mm;
        }

        .title { font-size: 20px; font-weight: bold; }

        .detail {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid #000;
        }

        .detail th, .detail td {
          border: 1px solid #000;
          height: 5mm;
        }

        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }

        .bottom {
          display: flex;
          justify-content: space-between;
          margin-top: 3mm;
        }

        .note {
          border: 2px solid #000;
          width: 60%;
          height: 14mm;
        }

        .total-box {
          border: 2px solid #000;
          width: 60mm;
        }

        @media print {
          header, nav, .no-print {
            display: none !important;
          }

          .page {
            padding: 0 !important;
          }
        }
      `}</style>
    </main>
  )
}