"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function PurchaseOrderPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [manufacturers, setManufacturers] = useState<any[]>([])

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: ordersData } = await supabase.from("orders").select("*")
    const { data: itemsData } = await supabase.from("order_items").select("*")
    const { data: productsData } = await supabase.from("products").select("*")
    const { data: clinicsData } = await supabase.from("clinics").select("*")
    const { data: manufacturersData } = await supabase.from("manufacturers").select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
    setProducts(productsData || [])
    setClinics(clinicsData || [])
    setManufacturers(manufacturersData || [])
  }

  function getClinic(id: string) {
    return clinics.find((c) => c.id === id)
  }

  function getProduct(id: string) {
    return products.find((p) => p.id === id)
  }

  function getManufacturer(id: string) {
    return manufacturers.find((m) => m.id === id)
  }

  function printPage() {
    window.print()
  }

  const purchaseRows: any[] = []

  orders.forEach((order) => {
    const clinic = getClinic(order.clinic_id)

    orderItems
      .filter((item) => item.order_id === order.id)
      .forEach((item) => {
        const product = getProduct(item.product_id)
        if (!product) return

        const reorderLevel = product.reorder_level ?? 10

        if (product.stock <= reorderLevel) {
          purchaseRows.push({
            manufacturer_id: product.manufacturer_id,
            product_name: product.name,
            quantity: item.quantity,
            unit: product.unit || "個",
            clinic_name: clinic?.name || "医院未設定",
          })
        }
      })
  })

  const groupedByManufacturer = purchaseRows.reduce((acc: any, row) => {
    const manufacturer = getManufacturer(row.manufacturer_id)
    const manufacturerName = manufacturer?.name || "メーカー未設定"

    if (!acc[manufacturerName]) {
      acc[manufacturerName] = []
    }

    acc[manufacturerName].push(row)
    return acc
  }, {})

  function PurchaseSheet({ manufacturerName, items }: any) {
    return (
      <section className="sheet">
        <div className="top-line"></div>

        <h1 className="title">商品発注書</h1>

        <div className="top-line"></div>

        <div className="info-area">
          <div className="left-info">
            <p>〒000-0000</p>
            <p>発注先住所</p>

            <div className="maker-name">
              {manufacturerName}　御中
            </div>

            <p>TEL：000-0000-0000</p>
            <p>FAX：000-0000-0000</p>

            <p className="message">下記の通り、発注いたします。</p>

            <p className="delivery-date">
              希望納期：＿＿＿年＿＿月＿＿日
            </p>
          </div>

          <div className="right-info">
            <p>発注年月日：{new Date().toLocaleDateString()}</p>
            <p className="company-name">株式会社 清新</p>
            <p>登録番号：T4180001119611</p>
            <p>〒454-0812</p>
            <p>名古屋市中川区五月通2-37</p>
            <p>黄金ステーションビル3階</p>
            <p>TEL：052-526-3223</p>
            <p>FAX：052-655-5977</p>
            <p>担当：</p>
            <p>発注書No：</p>
            <p className="page-no">Page：1</p>
          </div>
        </div>

        <table className="detail">
          <thead>
            <tr>
              <th className="no">No.</th>
              <th className="product">メーカー / 商品名</th>
              <th className="qty">数量</th>
              <th className="unit">単位</th>
              <th className="memo">摘要</th>
            </tr>
          </thead>

          <tbody>
            {Array.from({ length: 15 }).map((_, i) => {
              const item = items[i]

              return (
                <tr key={i}>
                  <td className="center">{i + 1}</td>
                  <td>{item?.product_name || ""}</td>
                  <td className="center">{item?.quantity || ""}</td>
                  <td className="center">{item?.unit || ""}</td>
                  <td>{item?.clinic_name || ""}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="note">
          備考：
        </div>
      </section>
    )
  }

  return (
    <main className="page">
      <button className="no-print" onClick={printPage}>
        印刷
      </button>

      {Object.keys(groupedByManufacturer).length === 0 && (
        <div className="empty">現在、発注が必要な商品はありません。</div>
      )}

      {Object.entries(groupedByManufacturer).map(([manufacturerName, items]: any) => (
        <div key={manufacturerName} className="a4">
          <PurchaseSheet manufacturerName={manufacturerName} items={items} />
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

        .no-print {
          padding: 10px 20px;
          margin-bottom: 16px;
          background: #111;
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: bold;
        }

        .empty {
          background: white;
          padding: 20px;
          border-radius: 8px;
        }

        .a4 {
          width: 210mm;
          height: 297mm;
          margin: 0 auto 24px;
          background: white;
          padding: 14mm 13mm;
          box-sizing: border-box;
          page-break-after: always;
        }

        .sheet {
          height: 100%;
          color: #000;
          font-size: 11px;
        }

        .top-line {
          border-top: 2px solid #000;
          margin-bottom: 6mm;
        }

        .title {
          text-align: center;
          font-size: 24px;
          letter-spacing: 2px;
          margin: 0 0 6mm 0;
        }

        .info-area {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20mm;
          margin-top: 6mm;
          margin-bottom: 4mm;
        }

        .left-info p,
        .right-info p {
          margin: 2px 0;
        }

        .maker-name {
          margin: 10mm 0 4mm;
          font-size: 17px;
          font-weight: bold;
        }

        .company-name {
          font-weight: bold;
          font-size: 14px;
        }

        .message {
          margin-top: 6mm !important;
        }

        .delivery-date {
          margin-top: 5mm !important;
          font-weight: bold;
          font-size: 14px;
        }

        .page-no {
          text-align: right;
          margin-top: 2mm !important;
        }

        .detail {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid #000;
          table-layout: fixed;
          font-size: 10.5px;
        }

        .detail th,
        .detail td {
          border: 1px solid #000;
          height: 8mm;
          padding: 2px 4px;
        }

        .detail th {
          background: #eee;
          text-align: center;
          font-weight: bold;
        }

        .no {
          width: 7%;
        }

        .product {
          width: 47%;
        }

        .qty {
          width: 8%;
        }

        .unit {
          width: 8%;
        }

        .memo {
          width: 30%;
        }

        .center {
          text-align: center;
        }

        .note {
          height: 28mm;
          border: 2px solid #000;
          margin-top: 2mm;
          padding: 5px;
          box-sizing: border-box;
        }

        @page {
          size: A4 portrait;
          margin: 0;
        }

        @media print {
          header,
          nav,
          .no-print {
            display: none !important;
          }

          body {
            margin: 0 !important;
            background: white !important;
          }

          .page {
            padding: 0 !important;
            background: white !important;
          }

          .a4 {
            margin: 0 !important;
            page-break-after: always;
          }
        }
      `}</style>
    </main>
  )
}