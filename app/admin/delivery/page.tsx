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

  function printPage() {
    window.print()
  }

  function formatNumber(num: number) {
    return num.toLocaleString()
  }

  function Sheet({ order, isCopy = false }: any) {
    const items = getItems(order.id)

    return (
      <section className="sheet">
        <div className="top">
          <div>
            <div>お客様コード：</div>
            <div className="clinic">{getClinicName(order.clinic_id)} 御中</div>
          </div>

          <div className="title">
            納 品 書{isCopy ? " 控" : ""}
          </div>

          <div>
            <div>発行日：{new Date(order.created_at).toLocaleDateString()}</div>
            <div className="company">株式会社 BIODENT</div>
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
              const item = items[i]
              const product = item ? getProduct(item.product_id) : null

              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="left-text">{product?.name || ""}</td>
                  <td>{item?.quantity || ""}</td>
                  <td>{item ? formatNumber(item.price) : ""}</td>
                  <td className="bold">
                    {item ? formatNumber(item.price * item.quantity) : ""}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="total-box">
          <div className="total-row">
            <span>小計</span>
            <span>{formatNumber(order.total_price)} 円</span>
          </div>
          <div className="total-row">
            <span>消費税</span>
            <span>0 円</span>
          </div>
          <div className="total-row grand">
            <span>合計</span>
            <span>{formatNumber(order.total_price)} 円</span>
          </div>
        </div>
      </section>
    )
  }

  return (
    <main className="page">
      <button className="no-print" onClick={printPage}>
        印刷
      </button>

      {orders.map((order) => (
        <div key={order.id} className="a4">
          <Sheet order={order} />
          <div className="cut">──── 切り取り線 ────</div>
          <Sheet order={order} isCopy />
        </div>
      ))}

      <style jsx>{`
        .page {
          padding: 20px;
        }

        .a4 {
          width: 210mm;
          height: 297mm;
          margin: auto;
          padding: 10mm;
          box-sizing: border-box;
          page-break-after: always;
        }

        .sheet {
          height: 45%;
          border: 1px solid #000;
          padding: 10px;
        }

        .top {
          display: flex;
          justify-content: space-between;
          margin-bottom: 10px;
        }

        .title {
          font-size: 20px;
          font-weight: bold;
        }

        .clinic {
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
          padding: 6px;
          height: 8mm;
          text-align: center;
        }

        .detail th {
          background: #eee;
        }

        .left-text {
          text-align: left;
        }

        .bold {
          font-weight: bold;
        }

        .total-box {
          width: 60mm;
          border: 2px solid #000;
          margin-top: 10px;
          margin-left: auto;
        }

        .total-row {
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid #000;
          padding: 6px;
        }

        .grand {
          font-weight: bold;
          font-size: 14px;
        }

        .cut {
          text-align: center;
          margin: 10px 0;
        }

        @media print {
          .no-print {
            display: none;
          }
        }
      `}</style>
    </main>
  )
}