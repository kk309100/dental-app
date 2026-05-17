'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function PurchasePage() {
  const [products, setProducts] = useState<any[]>([])
  const [manufacturers, setManufacturers] = useState<any[]>([])

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: productData, error: productError } = await supabase
      .from('products')
      .select('*')
      .order('stock', { ascending: true })

    const { data: manufacturerData, error: manufacturerError } = await supabase
      .from('manufacturers')
      .select('*')

    if (productError) console.error(productError)
    if (manufacturerError) console.error(manufacturerError)

    setProducts(productData || [])
    setManufacturers(manufacturerData || [])
  }

  function getManufacturerName(manufacturerId: string) {
    const manufacturer = manufacturers.find((item) => item.id === manufacturerId)
    return manufacturer ? manufacturer.name : 'メーカー未設定'
  }

  const purchaseProducts = products.filter(
    (product) => product.stock <= product.reorder_level
  )

  const manufacturerNames = [
    ...new Set(
      purchaseProducts.map((product) =>
        getManufacturerName(product.manufacturer_id)
      )
    ),
  ]

  return (
    <div>
      <h1>発注リスト</h1>
      <p>在庫が発注基準以下の商品を表示しています。</p>

      {purchaseProducts.length === 0 && (
        <p>現在、発注が必要な商品はありません。</p>
      )}

      {manufacturerNames.map((manufacturerName) => (
        <div key={manufacturerName}>
          <h2>{manufacturerName}</h2>

          {purchaseProducts
            .filter(
              (product) =>
                getManufacturerName(product.manufacturer_id) === manufacturerName
            )
            .map((product) => (
              <div key={product.id}>
                <p>商品名：{product.name}</p>
                <p>現在庫：{product.stock}</p>
                <p>発注基準：{product.reorder_level}</p>
                <p>推奨発注数：{product.reorder_level * 2 - product.stock}</p>
                <hr />
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}