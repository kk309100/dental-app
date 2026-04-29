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

  function printPage() {
    window.print()
  }

  function Sheet({ order, isCopy = false }: any) {
    const items = getItems(order.id)
    const subtotal = Number(order.total_price || 0)
    const tax = Math.floor(subtotal * 0.1)
    const total = subtotal + tax

    return (
      <div className="sheet">
        <div className="header">
          <div>
            <div className="small">お客様コード：</div>
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

        <div className="message">下記の通り納品いたしました。</div>

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
              const item = items[i]
              const product = item ? getProduct(item.product_id) : null

              return (
                <tr key={i}>
                  <td className="center">{i + 1}</td>
                  <td className="name">{product?.name || ""}</td>
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
        印刷
      </button>

      {orders.map((order) => (
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
        body {
          margin: 0;
        }

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

        .sheet {
          height: 100%;
          font-size: 10px;
        }

        .header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 4mm;
        }

        .small {
          font-size: 9px;
          margin-bottom: 6mm;
        }

        .clinic {
          font-size: 14px;
          font-weight: bold;
          border-bottom: 1px solid #000;
        }

        .title {
          font-size: 22px;
          font-weight: bold;
          letter-spacing: 6px;
        }

        .company {
          font-size: 9px;
        }

        .company-name {
          font-weight: bold;
        }

        .message {
          margin-bottom: 2mm;
        }

        .detail {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid #000;
        }

        .detail th,
        .detail td {
          border: 1px solid #000;
          height: 5.5mm;
          padding: 2px 4px;
        }

        .detail th {
          background: #eee;
          text-align: center;
        }

        .name {
          text-align: left;
        }

        .center {
          text-align: center;
        }

        .right {
          text-align: right;
        }

        .bold {
          font-weight: bold;
        }

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

        .total-row {
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid #000;
          padding: 3px 6px;
        }

        .grand {
          font-weight: bold;
          font-size: 12px;
        }

        /* ★ここが今回の最重要修正 */
        @media print {
          header,
          nav,
          .no-print {
            display: none !important;
          }

          body {
            margin: 0 !important;
          }

          .page {
            padding: 0 !important;
            background: white !important;
          }

          .a4 {
            margin: 0 !important;
          }
        }
      `}</style>
    </main>
  )
}