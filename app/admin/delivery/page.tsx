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

  function Sheet({ order, isCopy }: any) {
    return (
      <div className="sheet">
        <h2 className="title">納 品 書 {isCopy ? "（控）" : ""}</h2>

        <div className="info">
          <p>医院：{getClinicName(order.clinic_id)} 御中</p>
          <p>日付：{order.created_at}</p>
        </div>

        <table>
          <thead>
            <tr>
              <th>商品名</th>
              <th>数量</th>
              <th>単価</th>
              <th>金額</th>
            </tr>
          </thead>
          <tbody>
            {getItems(order.id).map((item: any) => {
              const product = getProduct(item.product_id)
              if (!product) return null

              return (
                <tr key={item.id}>
                  <td>{product.name}</td>
                  <td>{item.quantity}</td>
                  <td>{item.price}</td>
                  <td>{item.price * item.quantity}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <p className="total">合計：{order.total_price}円</p>
      </div>
    )
  }

  return (
    <main>
      <button onClick={printPage}>印刷</button>

      {orders.map((order) => (
        <div key={order.id} className="a4">
          <Sheet order={order} />
          <div className="cut">──────── 切り取り線 ────────</div>
          <Sheet order={order} isCopy />
        </div>
      ))}

      <style jsx>{`
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
          margin-bottom: 10px;
        }

        .title {
          text-align: center;
          font-size: 20px;
          margin-bottom: 10px;
        }

        .info {
          margin-bottom: 10px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th, td {
          border: 1px solid #000;
          padding: 4px;
          text-align: center;
        }

        .total {
          text-align: right;
          margin-top: 10px;
          font-weight: bold;
        }

        .cut {
          text-align: center;
          margin: 5px 0;
        }

        @media print {
          button {
            display: none;
          }
        }
      `}</style>
    </main>
  )
}