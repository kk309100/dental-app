'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [clinics, setClinics] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedClinic, setSelectedClinic] = useState('')
  const [searchText, setSearchText] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')

  useEffect(() => {
    fetchProducts()
    fetchClinics()
    fetchCategories()
  }, [])

  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*')
    setProducts(data || [])
  }

  async function fetchClinics() {
    const { data } = await supabase.from('clinics').select('*')
    setClinics(data || [])
  }

  async function fetchCategories() {
    const { data } = await supabase.from('categories').select('*')
    setCategories(data || [])
  }

  function addToCart(product) {
    const existing = cart.find((item) => item.id === product.id)

    if (existing) {
      if (existing.quantity >= product.stock) {
        alert('在庫数を超えています')
        return
      }

      setCart(
        cart.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      )
    } else {
      if (product.stock <= 0) {
        alert('在庫切れです')
        return
      }

      setCart([...cart, { ...product, quantity: 1 }])
    }
  }

  async function createOrder() {
    if (!selectedClinic) {
      alert('医院を選択してください')
      return
    }

    if (cart.length === 0) {
      alert('カートが空です')
      return
    }

    const total = cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    )

    const { data: order, error } = await supabase
      .from('orders')
      .insert([
        {
          total_price: total,
          status: '注文受付',
          clinic_id: selectedClinic,
        },
      ])
      .select()
      .single()

    if (error) {
      console.error(error)
      alert('注文作成でエラー')
      return
    }

    const orderItems = cart.map((item) => ({
      order_id: order.id,
      product_id: item.id,
      quantity: item.quantity,
      price: item.price,
    }))

    await supabase.from('order_items').insert(orderItems)

    for (const item of cart) {
      await supabase
        .from('products')
        .update({ stock: item.stock - item.quantity })
        .eq('id', item.id)
    }

    alert('注文完了')
    setCart([])
    fetchProducts()
  }

  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name
      .toLowerCase()
      .includes(searchText.toLowerCase())

    const matchesCategory =
      selectedCategory === '' || product.category_id === selectedCategory

    return matchesSearch && matchesCategory
  })

  const total = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>商品注文</h1>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 'bold' }}>医院を選択</label>
        <select
          value={selectedClinic}
          onChange={(e) => setSelectedClinic(e.target.value)}
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

      <input
        type="text"
        placeholder="商品名で検索"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{
          width: '100%',
          padding: 12,
          marginBottom: 12,
          borderRadius: 8,
          border: '1px solid #ccc',
          fontSize: 16,
        }}
      />

      <select
        value={selectedCategory}
        onChange={(e) => setSelectedCategory(e.target.value)}
        style={{
          width: '100%',
          padding: 12,
          marginBottom: 16,
          borderRadius: 8,
          border: '1px solid #ccc',
          fontSize: 16,
        }}
      >
        <option value="">すべてのカテゴリ</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      <h2 style={{ fontSize: 20 }}>商品一覧</h2>

      {filteredProducts.map((product) => (
        <div
          key={product.id}
          style={{
            border: '1px solid #ddd',
            borderRadius: 12,
            padding: 16,
            marginBottom: 12,
            background: '#fff',
          }}
        >
          <h3 style={{ fontSize: 18 }}>{product.name}</h3>
          <p>価格：{product.price}円</p>
          <p>在庫：{product.stock}</p>

          <button
            onClick={() => addToCart(product)}
            style={{
              width: '100%',
              padding: 12,
              borderRadius: 8,
              border: 'none',
              background: '#111',
              color: '#fff',
              fontSize: 16,
            }}
          >
            カートに入れる
          </button>
        </div>
      ))}

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: '#f8f8f8',
          padding: 16,
          borderTop: '1px solid #ddd',
        }}
      >
        <h2>カート</h2>

        {cart.length === 0 && <p>カートは空です</p>}

        {cart.map((item) => (
          <div key={item.id}>
            <p>
              {item.name} × {item.quantity}
            </p>
            <p>小計：{item.price * item.quantity}円</p>
          </div>
        ))}

        {cart.length > 0 && (
          <>
            <p style={{ fontWeight: 'bold' }}>合計：{total}円</p>

            <button
              onClick={createOrder}
              style={{
                width: '100%',
                padding: 14,
                borderRadius: 8,
                border: 'none',
                background: '#0070f3',
                color: '#fff',
                fontSize: 18,
                fontWeight: 'bold',
              }}
            >
              注文する
            </button>
          </>
        )}
      </div>
    </main>
  )
}