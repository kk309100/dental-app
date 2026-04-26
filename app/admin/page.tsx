'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function AdminPage() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [clinics, setClinics] = useState([])
  const [manufacturers, setManufacturers] = useState([])
  const [view, setView] = useState('orders') // orders / purchase

  useEffect(() => {
    fetchOrders()
    fetchProducts()
    fetchClinics()
    fetchManufacturers()
  }, [])

  async function fetchOrders() {
    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          id,
          quantity,
          price,
          product_id
        )
      `)
      .order('created_at', { ascending: false })

    setOrders(data || [])
  }

  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*')
    setProducts(data || [])
  }

  async function fetchClinics() {
    const { data } = await supabase.from('clinics').select('*')
    setClinics(data || [])
  }

  async function fetchManufacturers() {
    const { data } = await supabase.from('manufacturers').select('*')
    setManufacturers(data || [])
  }

  function getProductName(id) {
    const p = products.find((x) => x.id === id)
    return p ? p.name : id
  }

  function getClinicName(id) {
    const c = clinics.find((x) => x.id === id)
    return c ? c.name : '不明'
  }

  function getManufacturerName(id) {
    const m = manufacturers.find((x) => x.id === id)
    return m ? m.name : '未設定'
  }

  async function updateStatus(orderId, status) {
    await supabase.from('orders').update({ status }).eq('id', orderId)
    fetchOrders()
  }

  // 発注対象
  const purchaseProducts = products.filter(
    (p) => p.stock <= p.reorder_level
  )

  const manufacturerNames = [
    ...new Set(
      purchaseProducts.map((p) =>
        getManufacturerName(p.manufacturer_id)
      )
    ),
  ]

  return (
    <div style={{ padding: 16 }}>
      <h1>管理画面</h1>

      {/* タブ切り替え */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setView('orders')}>注文管理</button>
        <button onClick={() => setView('purchase')}>発注リスト</button>
      </div>

      {/* ================= 注文管理 ================= */}
      {view === 'orders' && (
        <div>
          {orders.map((order) => (
            <div key={order.id} style={{ border: '1px solid #ddd', padding: 12, marginBottom: 12 }}>
              <p>医院：{getClinicName(order.clinic_id)}</p>
              <p>金額：{order.total_price}円</p>
              <p>ステータス：{order.status}</p>

              <select
                value={order.status}
                onChange={(e) => updateStatus(order.id, e.target.value)}
              >
                <option>注文受付</option>
                <option>確認中</option>
                <option>納品準備中</option>
                <option>納品済み</option>
              </select>

              <h4>明細</h4>
              {order.order_items?.map((item) => (
                <div key={item.id}>
                  <p>{getProductName(item.product_id)}</p>
                  <p>{item.quantity}個</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ================= 発注リスト ================= */}
      {view === 'purchase' && (
        <div>
          {manufacturerNames.map((name) => (
            <div key={name}>
              <h2>{name}</h2>

              {purchaseProducts
                .filter(
                  (p) =>
                    getManufacturerName(p.manufacturer_id) === name
                )
                .map((p) => (
                  <div key={p.id}>
                    <p>{p.name}</p>
                    <p>在庫：{p.stock}</p>
                    <p>発注目安：{p.reorder_level}</p>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}