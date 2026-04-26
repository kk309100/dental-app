'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function HistoryPage() {
  const [clinics, setClinics] = useState([])
  const [selectedClinic, setSelectedClinic] = useState('')
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])

  useEffect(() => {
    fetchClinics()
    fetchProducts()
  }, [])

  async function fetchClinics() {
    const { data } = await supabase.from('clinics').select('*')
    setClinics(data || [])
  }

  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*')
    setProducts(data || [])
  }

  async function fetchOrders(clinicId) {
    setSelectedClinic(clinicId)

    if (!clinicId) {
      setOrders([])
      return
    }

    const { data, error } = await supabase
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
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      alert('注文履歴の取得でエラー')
      return
    }

    setOrders(data || [])
  }

  function getProductName(productId) {
    const product = products.find((item) => item.id === productId)
    return product ? product.name : productId
  }

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>注文履歴</h1>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 'bold' }}>医院を選択</label>
        <select
          value={selectedClinic}
          onChange={(e) => fetchOrders(e.target.value)}
          style={{
            width: '100%',
            padding: 12,
            marginTop: 8,
            borderRadius: 8,
            border: '1px solid #ccc',
            fontSize: 16,
          }}
        >
          <option value="">選択してください</option>
          {clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name}
            </option>
          ))}
        </select>
      </div>

      {selectedClinic && orders.length === 0 && (
        <p>注文履歴はありません</p>
      )}

      {orders.map((order) => (
        <div
          key={order.id}
          style={{
            border: '1px solid #ddd',
            borderRadius: 12,
            padding: 16,
            marginBottom: 12,
            background: '#fff',
          }}
        >
          <p>注文日：{order.created_at}</p>
          <p>ステータス：{order.status}</p>
          <p>合計金額：{order.total_price}円</p>

          <h3>注文明細</h3>

          {order.order_items?.map((item) => (
            <div key={item.id}>
              <p>商品名：{getProductName(item.product_id)}</p>
              <p>数量：{item.quantity}</p>
              <p>小計：{item.price * item.quantity}円</p>
            </div>
          ))}
        </div>
      ))}
    </main>
  )
}