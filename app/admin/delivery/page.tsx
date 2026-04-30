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

  function getClinic(id: string) {
    return clinics.find((c) => c.id === id)
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

  // 🔥 印刷
  async function printPage() {
    await markAsDelivered()
    window.print()
    setTimeout(() => fetchData(), 500)
  }

  function Sheet({ order, isCopy = false }: any) {
    const clinic = getClinic(order.clinic_id)
    const rawItems = getItems(order.id)

    // 🔥 同じ商品まとめる
    const items = Object.values(
      rawItems.reduce((acc: any, item: any) => {
        const key = item.product_id
        if (!acc[key]) acc[key] = { ...item }
        else acc[key].quantity += item.quantity
        return acc
      }, {})
    )

    const subtotal = Number(order.total_price || 0)
    const tax = Math.floor(subtotal * 0.1)
    const total = subtotal + tax

    return (
      <div className="sheet">
        <div className="header">
          {/* 左：医院 */}
          <div>
            <div className="small">納品書番号：{order.delivery_number}</div>

            <div className="clinic">
              {clinic?.name || ""} 御中
            </div>

            <div className="clinic-info">
              {clinic?.address || ""}
            </div>

            <div className="clinic-info">
              TEL：{clinic?.phone || ""}
            </div>
          </div>

          {/* 中央：タイトル */}
          <div className="title">
            納　品　書{isCopy ? "（控）" : ""}
          </div>

          {/* 右：自社 */}
          <div className="company">
            <div>発行日：{new Date(order.created_at).toLocaleDateString()}</div>

            <div className="company-name">株式会社 BIODENT</div>

            <div>〒454-0812</div>
            <div>名古屋市中川区五月通2-37</div>
            <div>黄金ステーションビル3階</div>

            <div>TEL：052-526-3223</div>
            <div>FAX：052-655-5977</div>
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
                  <td className="right">
                    {item ? formatNumber(item.price) : ""}
                  </td>
                  <td className="right bold">
                    {item
                      ? formatNumber(item.price * item.quantity)
                      : ""}
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
        印刷（実行で納品済みになります）
      </button>

      {/* 🔥 納品済みは非表示 */}
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

        .page {
          padding: 20px;
          background: #eee;
        }

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

        .small { font-size: 9px; margin-bottom: 4mm; }

        .clinic {
          font-size: 14px;
          font-weight: bold;
          border-bottom: 1px solid #000;
        }

        .clinic-info {
          font-size: 10px;
        }

        .title {
          font-size: 20px;
          font-weight: bold;
          letter-spacing: 4px;
        }

        .company {
          font-size: 10px;
        }

        .company-name {
          font-weight: bold;
        }

        .detail {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid #000;
        }

        .detail th,
        .detail td {
          border: 1px solid #000;
          height: 5mm;
          padding: 2px;
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