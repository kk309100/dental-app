"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import Seal from "@/app/components/Seal"

export default function PurchaseOrderPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: ordersData } = await supabase.from("orders").select("*")
    const { data: itemsData } = await supabase
      .from("order_items")
      .select("*")
      .or("purchase_status.is.null,purchase_status.eq.未発注")

    const { data: productsData } = await supabase.from("products").select("*")
    const { data: clinicsData } = await supabase.from("clinics").select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
    setProducts(productsData || [])
    setClinics(clinicsData || [])
    setLoading(false)
  }

  function getOrder(orderId: string) {
    return orders.find((order) => order.id === orderId)
  }

  function getClinicName(clinicId: string) {
    return clinics.find((clinic) => clinic.id === clinicId)?.name || "医院不明"
  }

  function getProduct(productId: string) {
    return products.find((product) => product.id === productId)
  }

  const purchaseRows = useMemo(() => {
    return orderItems.map((item) => {
      const product = getProduct(item.product_id)
      const order = getOrder(item.order_id)
      const clinicName = order ? getClinicName(order.clinic_id) : "医院不明"

      return {
        item_id: item.id,
        order_id: item.order_id,
        product_id: item.product_id,
        product_name: item.product_name || product?.name || "商品名なし",
        manufacturer: product?.manufacturer || "メーカー未設定",
        quantity: Number(item.quantity || 0),
        unit: product?.unit || "個",
        clinic_name: clinicName,
        delivery_number: order?.delivery_number || "-",
      }
    })
  }, [orderItems, products, orders, clinics])

  const groupedByManufacturer = useMemo(() => {
    return purchaseRows.reduce((acc: any, row) => {
      if (!acc[row.manufacturer]) acc[row.manufacturer] = []
      acc[row.manufacturer].push(row)
      return acc
    }, {})
  }, [purchaseRows])

  async function markManufacturerAsPurchased(manufacturerName: string) {
    const rows = groupedByManufacturer[manufacturerName] || []
    const ids = rows.map((row: any) => row.item_id)

    if (ids.length === 0) return

    const ok = confirm(`${manufacturerName} の発注を発注済みにしますか？`)
    if (!ok) return

    const { error } = await supabase
      .from("order_items")
      .update({
        purchase_status: "発注済み",
        purchased_at: new Date().toISOString(),
      })
      .in("id", ids)

    if (error) {
      console.error(error)
      alert("発注済み処理でエラーが出ました")
      return
    }

    alert("発注済みにしました")
    fetchData()
  }

  function printPage() {
    window.print()
  }

  function PurchaseSheet({ manufacturerName, items }: any) {
    return (
      <section className="sheet">
        <div className="top-line"></div>

        <h1 className="title">商品発注書</h1>

        <div className="top-line"></div>

        <div className="info-area">
          <div className="left-info">
            <p>発注先</p>

            <div className="maker-name">{manufacturerName}　御中</div>

            <p className="message">下記の通り、発注いたします。</p>
            <p className="delivery-date">希望納期：＿＿＿年＿＿月＿＿日</p>
          </div>

          <div className="right-info" style={{ position: "relative", paddingRight: 60 }}>
            <p>発注年月日：{new Date().toLocaleDateString()}</p>
            <p className="company-name">株式会社 清新</p>
            <p>〒454-0812</p>
            <p>名古屋市中川区五月通2-37</p>
            <p>黄金ステーションビル3階</p>
            <p>TEL：052-526-3223</p>
            <p>FAX：052-655-5977</p>
            <p>担当：</p>
            {/* 印影 */}
            <div style={{ position: "absolute", top: 0, right: 0 }}>
              <Seal size={50} />
            </div>
          </div>
        </div>

        <table className="detail">
          <thead>
            <tr>
              <th className="no">No.</th>
              <th className="product">商品名</th>
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
                  <td>
                    {item
                      ? `${item.clinic_name} / ${item.delivery_number}`
                      : ""}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="note">備考：</div>
      </section>
    )
  }

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  return (
    <main className="page">
      <div className="no-print toolbar">
        <Link href="/admin">
          <button className="sub-btn">管理画面へ戻る</button>
        </Link>

        <button className="main-btn" onClick={printPage}>
          印刷
        </button>
      </div>

      {Object.keys(groupedByManufacturer).length === 0 && (
        <div className="empty">現在、未発注の商品はありません。</div>
      )}

      {Object.entries(groupedByManufacturer).map(
        ([manufacturerName, items]: any) => (
          <div key={manufacturerName} className="block">
            <div className="no-print action-box">
              <h2>{manufacturerName}</h2>
              <p>{items.length}件の未発注商品があります。</p>

              <button
                className="done-btn"
                onClick={() => markManufacturerAsPurchased(manufacturerName)}
              >
                このメーカーを発注済みにする
              </button>
            </div>

            <div className="a4">
              <PurchaseSheet manufacturerName={manufacturerName} items={items} />
            </div>
          </div>
        )
      )}

      <style jsx global>{`
        body {
          margin: 0;
        }

        .page {
          padding: 20px;
          background: #eee;
        }

        .toolbar {
          max-width: 900px;
          margin: 0 auto 16px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .main-btn,
        .sub-btn,
        .done-btn {
          width: 100%;
          padding: 12px;
          border-radius: 10px;
          border: none;
          font-weight: bold;
          cursor: pointer;
        }

        .main-btn {
          background: #111;
          color: white;
        }

        .sub-btn {
          background: white;
          color: #111;
          border: 1px solid #ddd;
        }

        .done-btn {
          background: #0f766e;
          color: white;
        }

        .empty {
          max-width: 900px;
          margin: 0 auto;
          background: white;
          padding: 20px;
          border-radius: 12px;
        }

        .action-box {
          max-width: 210mm;
          margin: 0 auto 12px;
          background: white;
          padding: 14px;
          border-radius: 12px;
          border: 1px solid #ddd;
        }

        .block {
          margin-bottom: 24px;
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