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
    const { data: ordersData } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })

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

  function DeliverySheet({ order, isCopy = false }: any) {
    const items = getItems(order.id)

    return (
      <section className="sheet">
        <div className="top">
          <div className="left">
            <div className="customer-code">お客様コード：</div>
            <div className="clinic">{getClinicName(order.clinic_id)} 御中</div>
          </div>

          <div className="center">
            <div className="title">納　品　書{isCopy ? "　控" : ""}</div>
          </div>

          <div className="right">
            <div>発行日：{new Date(order.created_at).toLocaleDateString()}</div>
            <div className="company">株式会社 BIODENT</div>
            <div>〒000-0000</div>
            <div>東京都〇〇区〇〇 1-2-3</div>
            <div>TEL：000-0000-0000</div>
            <div>FAX：000-0000-0000</div>
          </div>
        </div>

        <div className="message">下記の通り納品いたしました。</div>

        <table className="detail">
          <thead>
            <tr>
              <th className="no">No.</th>
              <th className="name">品名</th>
              <th className="qty">数量</th>
              <th className="unit">単価</th>
              <th className="amount">金額</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, index: number) => {
              const product = getProduct(item.product_id)
              return (
                <tr key={item.id}>
                  <td>{index + 1}</td>
                  <td className="text-left">{product?.name || ""}</td>
                  <td>{item.quantity}</td>
                  <td>{item.price}</td>
                  <td>{item.price * item.quantity}</td>
                </tr>
              )
            })}

            {Array.from({ length: Math.max(0, 8 - items.length) }).map((_, i) => (
              <tr key={`empty-${i}`}>
                <td>&nbsp;</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="bottom">
          <div className="note">
            <div>備考：</div>
            <div className="note-box"></div>
          </div>

          <div className="total-box">
            <div className="total-row">
              <span>小計</span>
              <span>{order.total_price} 円</span>
            </div>
            <div className="total-row">
              <span>消費税</span>
              <span>0 円</span>
            </div>
            <div className="total-row grand">
              <span>合計</span>
              <span>{order.total_price} 円</span>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <main className="page">
      <div className="no-print toolbar">
        <button onClick={printPage}>印刷</button>
      </div>

      {orders.map((order) => (
        <div key={order.id} className="a4">
          <DeliverySheet order={order} />
          <div className="cut-line">────────────　切り取り線　────────────</div>
          <DeliverySheet order={order} isCopy />
        </div>
      ))}

      <style jsx>{`
        .page {
          background: #eee;
          padding: 20px;
        }

        .toolbar {
          margin-bottom: 16px;
        }

        .toolbar button {
          padding: 10px 18px;
          border: none;
          border-radius: 8px;
          background: #111;
          color: white;
          font-weight: bold;
        }

        .a4 {
          width: 210mm;
          min-height: 297mm;
          background: white;
          margin: 0 auto 24px;
          padding: 8mm;
          box-sizing: border-box;
          page-break-after: always;
        }

        .sheet {
          height: 132mm;
          border: 1px solid #333;
          padding: 6mm;
          box-sizing: border-box;
          font-size: 11px;
        }

        .top {
          display: grid;
          grid-template-columns: 1fr 1fr 1.1fr;
          gap: 8px;
          align-items: start;
          margin-bottom: 6mm;
        }

        .customer-code {
          font-size: 10px;
          margin-bottom: 8mm;
        }

        .clinic {
          font-size: 17px;
          font-weight: bold;
          border-bottom: 1px solid #333;
          padding-bottom: 4px;
        }

        .center {
          text-align: center;
        }

        .title {
          font-size: 22px;
          font-weight: bold;
          letter-spacing: 8px;
          border-bottom: 3px double #333;
          display: inline-block;
          padding-bottom: 4px;
        }

        .right {
          font-size: 10px;
          line-height: 1.6;
          text-align: left;
        }

        .company {
          font-size: 14px;
          font-weight: bold;
          margin-top: 4px;
        }

        .message {
          margin-bottom: 4mm;
        }

        table.detail {
          width: 100%;
          border-collapse: collapse;
          font-size: 10.5px;
        }

        .detail th,
        .detail td {
          border: 1px solid #333;
          height: 7mm;
          padding: 2px 4px;
          text-align: center;
        }

        .detail th {
          background: #f5f5f5;
          font-weight: bold;
        }

        .no {
          width: 9%;
        }

        .name {
          width: 47%;
        }

        .qty {
          width: 12%;
        }

        .unit {
          width: 16%;
        }

        .amount {
          width: 16%;
        }

        .text-left {
          text-align: left !important;
        }

        .bottom {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          margin-top: 4mm;
        }

        .note {
          flex: 1;
        }

        .note-box {
          height: 18mm;
          border: 1px solid #333;
          margin-top: 4px;
        }

        .total-box {
          width: 60mm;
          border: 1px solid #333;
        }

        .total-row {
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid #333;
          padding: 4px 8px;
        }

        .total-row:last-child {
          border-bottom: none;
        }

        .grand {
          font-weight: bold;
          font-size: 13px;
        }

        .cut-line {
          height: 13mm;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #555;
        }

        @media print {
          .no-print {
            display: none;
          }

          .page {
            background: white;
            padding: 0;
          }

          .a4 {
            margin: 0;
            padding: 8mm;
            page-break-after: always;
          }
        }
      `}</style>
    </main>
  )
}