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

  function formatNumber(num: number) {
    return Number(num || 0).toLocaleString()
  }

  function printPage() {
    window.print()
  }

  function Sheet({ order, isCopy = false }: any) {
    const items = getItems(order.id)
    const tax = Math.floor(order.total_price * 0.1)
    const totalWithTax = order.total_price + tax

    return (
      <section className="sheet">
        <div className="header">
          <div className="customer">
            <div className="code">お客様コード：</div>
            <div className="clinic-name">{getClinicName(order.clinic_id)}　御中</div>
          </div>

          <div className="title">
            納　品　書{isCopy ? "（控）" : ""}
          </div>

          <div className="company">
            <div>発行日：{new Date(order.created_at).toLocaleDateString()}</div>
            <div className="company-name">株式会社 BIODENT</div>
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
              <th className="col-no">No.</th>
              <th className="col-name">品名</th>
              <th className="col-qty">数量</th>
              <th className="col-price">単価</th>
              <th className="col-amount">金額</th>
            </tr>
          </thead>

          <tbody>
            {Array.from({ length: 10 }).map((_, i) => {
              const item = items[i]
              const product = item ? getProduct(item.product_id) : null

              return (
                <tr key={i}>
                  <td className="center">{i + 1}</td>
                  <td className="product-name">{product?.name || ""}</td>
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
          <div className="note">
            <div className="note-title">備考：</div>
          </div>

          <div className="total-box">
            <div className="total-row">
              <span>小計</span>
              <span>{formatNumber(order.total_price)} 円</span>
            </div>
            <div className="total-row">
              <span>消費税</span>
              <span>{formatNumber(tax)} 円</span>
            </div>
            <div className="total-row grand">
              <span>合計</span>
              <span>{formatNumber(totalWithTax)} 円</span>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <main className="page">
      <button className="no-print print-button" onClick={printPage}>
        印刷
      </button>

      {orders.map((order) => (
        <div key={order.id} className="a4">
          <Sheet order={order} />
          <div className="cut-line">────────────　切　り　取　り　線　────────────</div>
          <Sheet order={order} isCopy />
        </div>
      ))}

      <style jsx>{`
        .page {
          background: #eee;
          padding: 20px;
        }

        .print-button {
          padding: 10px 20px;
          margin-bottom: 16px;
          background: #111;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-weight: bold;
        }

        .a4 {
          width: 210mm;
          height: 297mm;
          background: white;
          margin: 0 auto 24px;
          padding: 8mm 10mm;
          box-sizing: border-box;
          page-break-after: always;
        }

        .sheet {
          height: 132mm;
          box-sizing: border-box;
          padding: 3mm;
          font-size: 11px;
          color: #000;
        }

        .header {
          display: grid;
          grid-template-columns: 1.1fr 1fr 1.1fr;
          align-items: start;
          margin-bottom: 6mm;
        }

        .code {
          font-size: 10px;
          margin-bottom: 8mm;
        }

        .clinic-name {
          display: inline-block;
          min-width: 58mm;
          font-size: 16px;
          font-weight: bold;
          padding-bottom: 2px;
          border-bottom: 1.5px solid #000;
        }

        .title {
          text-align: center;
          font-size: 24px;
          font-weight: bold;
          letter-spacing: 7px;
        }

        .company {
          font-size: 10px;
          line-height: 1.45;
        }

        .company-name {
          font-size: 15px;
          font-weight: bold;
          margin: 2px 0;
        }

        .message {
          margin-bottom: 2mm;
          font-size: 11px;
        }

        .detail {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid #000;
          table-layout: fixed;
          font-size: 11px;
        }

        .detail th {
          border: 1.5px solid #000;
          border-bottom: 2px solid #000;
          background: #f2f2f2;
          height: 7mm;
          text-align: center;
          font-weight: bold;
        }

        .detail td {
          border: 1.5px solid #000;
          height: 7mm;
          padding: 2px 5px;
          vertical-align: middle;
        }

        .col-no {
          width: 7%;
        }

        .col-name {
          width: 50%;
        }

        .col-qty {
          width: 11%;
        }

        .col-price {
          width: 16%;
        }

        .col-amount {
          width: 16%;
        }

        .center {
          text-align: center;
        }

        .right {
          text-align: right;
        }

        .product-name {
          text-align: left;
          font-weight: 500;
        }

        .bold {
          font-weight: bold;
        }

        .bottom {
          display: grid;
          grid-template-columns: 1fr 64mm;
          gap: 10mm;
          margin-top: 4mm;
        }

        .note {
          border: 2px solid #000;
          height: 19mm;
          padding: 4px;
          box-sizing: border-box;
        }

        .note-title {
          font-weight: bold;
        }

        .total-box {
          border: 2px solid #000;
          height: fit-content;
        }

        .total-row {
          display: grid;
          grid-template-columns: 1fr 1.2fr;
          border-bottom: 1.5px solid #000;
        }

        .total-row:last-child {
          border-bottom: none;
        }

        .total-row span {
          padding: 4px 8px;
        }

        .total-row span:first-child {
          border-right: 1.5px solid #000;
          font-weight: bold;
        }

        .grand {
          font-size: 16px;
          font-weight: bold;
          border-top: 2px solid #000;
        }

        .cut-line {
          height: 12mm;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #333;
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
            padding: 8mm 10mm;
            page-break-after: always;
          }
        }
      `}</style>
    </main>
  )
}