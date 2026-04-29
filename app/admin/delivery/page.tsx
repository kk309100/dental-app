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
    const subtotal = Number(order.total_price || 0)
    const tax = Math.floor(subtotal * 0.1)
    const total = subtotal + tax

    return (
      <section className="delivery-sheet">
        <div className="delivery-header">
          <div className="customer-area">
            <div className="small">お客様コード：</div>
            <div className="clinic-name">{getClinicName(order.clinic_id)}　御中</div>
          </div>

          <div className="title-area">
            <div className="delivery-title">
              納　品　書{isCopy ? "（控）" : ""}
            </div>
          </div>

          <div className="company-area">
            <div>発行日：{new Date(order.created_at).toLocaleDateString()}</div>
            <div className="company-name">株式会社 BIODENT</div>
            <div>〒000-0000</div>
            <div>東京都〇〇区〇〇 1-2-3</div>
            <div>TEL：000-0000-0000</div>
            <div>FAX：000-0000-0000</div>
          </div>
        </div>

        <div className="message">下記の通り納品いたしました。</div>

        <table className="delivery-table">
          <thead>
            <tr>
              <th className="no">No.</th>
              <th className="name">品名</th>
              <th className="qty">数量</th>
              <th className="price">単価</th>
              <th className="amount">金額</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, index) => {
              const item = items[index]
              const product = item ? getProduct(item.product_id) : null

              return (
                <tr key={index}>
                  <td className="center">{index + 1}</td>
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

        <div className="bottom-area">
          <div className="note-box">
            <strong>備考：</strong>
          </div>

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
      </section>
    )
  }

  return (
    <main className="delivery-page">
      <button className="print-button no-print" onClick={printPage}>
        印刷
      </button>

      {orders.map((order) => (
        <div key={order.id} className="a4-page">
          <Sheet order={order} />
          <div className="cut-line">────────────　切　り　取　り　線　────────────</div>
          <Sheet order={order} isCopy />
        </div>
      ))}

      <style jsx global>{`
        body {
          margin: 0;
          background: #eeeeee;
        }

        .delivery-page {
          padding: 20px;
          background: #eeeeee;
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

        .a4-page {
          width: 210mm;
          height: 297mm;
          background: #fff;
          margin: 0 auto 24px;
          padding: 8mm 10mm;
          box-sizing: border-box;
          page-break-after: always;
        }

        .delivery-sheet {
          height: 132mm;
          box-sizing: border-box;
          padding: 3mm;
          font-size: 11px;
          color: #000;
          background: #fff;
        }

        .delivery-header {
          display: grid;
          grid-template-columns: 1.15fr 1fr 1.15fr;
          align-items: start;
          margin-bottom: 5mm;
        }

        .small {
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

        .title-area {
          text-align: center;
        }

        .delivery-title {
          font-size: 24px;
          font-weight: bold;
          letter-spacing: 7px;
        }

        .company-area {
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

        .delivery-table {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid #000;
          table-layout: fixed;
          font-size: 11px;
        }

        .delivery-table th {
          border: 1.5px solid #000;
          border-bottom: 2px solid #000;
          background: #f2f2f2;
          height: 7mm;
          text-align: center;
          font-weight: bold;
        }

        .delivery-table td {
          border: 1.5px solid #000;
          height: 7mm;
          padding: 2px 5px;
          vertical-align: middle;
        }

        .delivery-table .no {
          width: 7%;
        }

        .delivery-table .name {
          width: 50%;
        }

        .delivery-table .qty {
          width: 11%;
        }

        .delivery-table .price {
          width: 16%;
        }

        .delivery-table .amount {
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

        .bottom-area {
          display: grid;
          grid-template-columns: 1fr 64mm;
          gap: 10mm;
          margin-top: 4mm;
        }

        .note-box {
          border: 2px solid #000;
          height: 19mm;
          padding: 4px;
          box-sizing: border-box;
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

        @page {
          size: A4 portrait;
          margin: 0;
        }

        @media print {
          body {
            background: #fff;
          }

          nav,
          .no-print,
          .print-button {
            display: none !important;
          }

          .delivery-page {
            padding: 0;
            background: #fff;
          }

          .a4-page {
            margin: 0;
            padding: 8mm 10mm;
            box-shadow: none;
          }

          a[href]:after {
            content: "";
          }
        }
      `}</style>
    </main>
  )
}