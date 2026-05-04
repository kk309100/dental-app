"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("すべて")
  const [clinicFilter, setClinicFilter] = useState("すべて")
  const [openId, setOpenId] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: ordersData } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })

    const { data: itemsData } = await supabase
      .from("order_items")
      .select("*")

    const { data: clinicsData } = await supabase
      .from("clinics")
      .select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
    setClinics(clinicsData || [])
    setLoading(false)
  }

  function getClinicName(id: string) {
    return clinics.find((c) => c.id === id)?.name || "不明"
  }

  function getItems(orderId: string) {
    return orderItems.filter((i) => i.order_id === orderId)
  }

  function normalizeText(v: any) {
    return String(v || "")
      .toLowerCase()
      .normalize("NFKC")
  }

  const filteredOrders = useMemo(() => {
    const keyword = normalizeText(search)

    return orders.filter((order) => {
      const items = getItems(order.id)
      const names = items.map((i) => i.product_name).join(" ")

      const target = normalizeText(
        ${order.delivery_number || ""} ${order.status} ${names || ""}`
      )

      const matchSearch = !keyword || target.includes(keyword)
      const matchStatus =
        statusFilter === "すべて" || order.status === statusFilter
      const matchClinic =
        clinicFilter === "すべて" || order.clinic_id === clinicFilter

      return matchSearch && matchStatus && matchClinic
    })
  }, [orders, orderItems, search, statusFilter, clinicFilter])

  const statuses = ["すべて", "注文受付", "確認中", "準備中", "納品済み", "キャンセル"]

  async function updateStatus(orderId: string, status: string) {
    await supabase.from("orders").update({ status }).eq("id", orderId)

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status } : o))
    )
  }

  if (loading) return <p>読み込み中...</p>

  return (
    <main style={page}>
      <Link href="/admin">
        <button style={back}>← 戻る</button>
      </Link>

      <h1>注文管理</h1>

      <input
        placeholder="納品書番号・商品検索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={input}
      />

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        style={input}
      >
        {statuses.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>

      <select
        value={clinicFilter}
        onChange={(e) => setClinicFilter(e.target.value)}
        style={input}
      >
        <option>すべて</option>
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {filteredOrders.map((order) => {
        const items = getItems(order.id)
        const open = openId === order.id

        return (
          <div key={order.id} style={card}>
            <div style={row}>
              <div>
                <p style={bold}>{order.delivery_number}</p>
                <p>{getClinicName(order.clinic_id)}</p>
                <p>{new Date(order.created_at).toLocaleString()}</p>
              </div>

              <select
                value={order.status}
                onChange={(e) =>
                  updateStatus(order.id, e.target.value)
                }
              >
                {statuses.slice(1).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>

            <p>税抜 {order.total_price?.toLocaleString()}円</p>

            <button onClick={() => setOpenId(open ? "" : order.id)}>
              {open ? "閉じる" : "明細"}
            </button>

            {open && (
              <div>
                {items.map((i) => (
                  <div key={i.id} style={item}>
                    <p>{i.product_name}</p>
                    <p>
                      {i.quantity} × {i.price}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <Link href={`/order-edit/${order.id}`}>
              <button style={btn}>編集</button>
            </Link>
          </div>
        )
      })}
    </main>
  )
}

const page = { maxWidth: 700, margin: "0 auto", padding: 20 }
const back = { marginBottom: 10 }
const input = { width: "100%", padding: 10, marginBottom: 10 }
const card = { border: "1px solid #ddd", padding: 10, marginBottom: 10 }
const row = { display: "flex", justifyContent: "space-between" }
const bold = { fontWeight: "bold" }
const item = { borderBottom: "1px solid #eee", padding: 5 }
const btn = { marginTop: 10, padding: 10 }