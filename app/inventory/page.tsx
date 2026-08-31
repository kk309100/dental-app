"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Html5Qrcode } from "html5-qrcode"
import { playBeep } from "@/lib/beep"
import { useRouter } from "next/navigation"
import { parseCSV, downloadCSV, toCSV } from "@/lib/csv"

const C = {
  primary: "#22a648",
  blue:    "#2563eb",
  red:     "#ef4444",
  orange:  "#f08c00",
  text:    "#1a1a1a",
  sub:     "#6b7280",
  border:  "#e5e7eb",
  bg:      "#f8f9fa",
  card:    "#ffffff",
}

type Item = {
  id: string
  product_name: string
  maker: string | null
  barcode: string | null
  stock_quantity: number
  min_stock: number | null
  category: string | null
  shelf_no: string | null
  location: string | null
  supplier: string | null
  units_per_package: number | null
  product_id: string | null
  unit: string | null
  stock_unit: string | null
  created_at: string | null
  item_image_url: string | null
}

type Log = {
  id: string
  product_name: string
  change_type: string
  quantity: number
  stock_before: number
  stock_after: number
  staff_name: string | null
  occurred_at: string
}

type ActionModal = {
  item: Item
  type: "use" | "restock"
  qty: number
}

export default function ClinicInventoryPage() {
  const router = useRouter()

  const [tab, setTab]             = useState<"record" | "history">("record")
  const [items, setItems]         = useState<Item[]>([])
  const [logs, setLogs]           = useState<Log[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [scanning, setScanning]   = useState(false)
  const [clinicId, setClinicId]   = useState("")
  const [staffName, setStaffName] = useState("")

  const [locationFilter, setLocationFilter] = useState("すべて")
  const [categoryFilter, setCategoryFilter] = useState("すべて")

  const [masterCategories, setMasterCategories] = useState<string[]>([])
  const [catMgmtModal, setCatMgmtModal]         = useState(false)
  const [newCatName, setNewCatName]             = useState("")
  const [catSaving, setCatSaving]               = useState(false)

  const [toast, setToast]         = useState<string | null>(null)
  const [undoAction, setUndoAction] = useState<(() => void) | null>(null)
  const [flashId, setFlashId]     = useState<string | null>(null)

  const [actionModal, setActionModal] = useState<ActionModal | null>(null)
  const [focusModal, setFocusModal]   = useState<{ item: Item; type: "use" | "restock" } | null>(null)

  const [editStockId, setEditStockId]     = useState<string | null>(null)
  const [editStockValue, setEditStockValue] = useState("")

  const [editMinId, setEditMinId]     = useState<string | null>(null)
  const [editMinValue, setEditMinValue] = useState("")

  const [addModal, setAddModal]   = useState(false)
  const [addForm, setAddForm]     = useState({ product_name: "", maker: "", barcode: "", stock_quantity: "0", min_stock: "", location: "", shelf_no: "", supplier: "", category: "", units_per_package: "", product_id: "", unit: "", stock_unit: "" })
  const [addSaving, setAddSaving] = useState(false)

  const [editItemModal, setEditItemModal] = useState<Item | null>(null)
  const [editItemForm, setEditItemForm]   = useState({ product_name: "", maker: "", barcode: "", min_stock: "", location: "", shelf_no: "", supplier: "", category: "", units_per_package: "", unit: "", stock_unit: "" })
  const [editItemSaving, setEditItemSaving] = useState(false)

  const [optionsMenu, setOptionsMenu] = useState<Item | null>(null)

  const [bulkDeleteMode, setBulkDeleteMode] = useState(false)
  const [bulkSelected, setBulkSelected]     = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting]     = useState(false)

  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoTargetId = useRef<string | null>(null)

  const [importModal, setImportModal] = useState(false)
  const [importRows, setImportRows]   = useState<Record<string, string>[]>([])
  const [importing, setImporting]     = useState(false)
  const [importMode, setImportMode]   = useState<"insert" | "update">("insert")
  const csvInputRef = useRef<HTMLInputElement>(null)

  const [productSuggestions, setProductSuggestions] = useState<{ id: string; name: string; manufacturer: string | null }[]>([])
  const [showSuggestions, setShowSuggestions]       = useState(false)

  const [historyFilter, setHistoryFilter] = useState<"today" | "week" | "all">("today")
  const [staffFilter, setStaffFilter]     = useState("すべて")

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scannerRef = useRef<any>(null)
  const itemsRef = useRef<Item[]>([])

  // 連続スキャンカート
  const [scanCart, setScanCart] = useState<{ item: Item; qty: number }[]>([])
  const [scanCartOpen, setScanCartOpen] = useState(false)
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [scannerReady, setScannerReady] = useState(false) // re-render後にスキャナー起動するフラグ

  useEffect(() => { init() }, [])
  useEffect(() => { itemsRef.current = items }, [items])

  // scannerReady が true になった（＝divがDOMに表示された）後にスキャナーを起動
  useEffect(() => {
    if (!scannerReady) return
    setScannerReady(false)
    const scanner = new Html5Qrcode("inv-reader")
    scannerRef.current = scanner
    const lastScan = { code: "", time: 0 }
    scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 280, height: 280 } },
      (code) => {
        const now = Date.now()
        if (code === lastScan.code && now - lastScan.time < 1500) return
        lastScan.code = code; lastScan.time = now
        const currentItems = itemsRef.current
        let found: Item | undefined
        if (code.startsWith("inv:")) {
          found = currentItems.find((i) => i.id === code.slice(4))
        } else {
          found = currentItems.find((i) => String(i.barcode || "") === code)
            || currentItems.find((i) => i.product_name === code)
        }
        if (!found) { playBeep("error"); showToast("❌ 商品が見つかりません"); return }
        playBeep("success")
        setScanCart((prev) => {
          const ex = prev.find((e) => e.item.id === found!.id)
          if (ex) {
            showToast(`📦 ${found!.product_name}（合計 ${ex.qty + 1}点）`)
            return prev.map((e) => e.item.id === found!.id ? { ...e, qty: e.qty + 1 } : e)
          }
          showToast(`✅ ${found!.product_name} をカートに追加`)
          return [...prev, { item: found!, qty: 1 }]
        })
        setScanCartOpen(true)
      }, () => {}
    ).catch(() => setScanning(false))
  }, [scannerReady])

  async function init() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }
    setClinicId(profile.clinic_id)
    setStaffName(profile.login_code || "")
    await Promise.all([fetchAll(profile.clinic_id), fetchCategories(profile.clinic_id)])
    setLoading(false)
  }

  async function fetchCategories(cid?: string) {
    const clinicIdToUse = cid || clinicId
    const { data } = await supabase.from("inventory_categories")
      .select("name").eq("clinic_id", clinicIdToUse).order("sort_order")
    setMasterCategories((data || []).map((r: any) => r.name))
  }

  async function addCategory() {
    const name = newCatName.trim()
    if (!name) return
    setCatSaving(true)
    const { error } = await supabase.from("inventory_categories").insert({
      clinic_id: clinicId,
      name,
      sort_order: masterCategories.length,
    })
    if (!error) {
      setMasterCategories(prev => [...prev, name])
      setNewCatName("")
    }
    setCatSaving(false)
  }

  async function deleteCategory(name: string) {
    if (!confirm(`「${name}」を削除しますか？\n※このカテゴリが設定された商品のカテゴリは空欄になります`)) return
    await supabase.from("inventory_categories").delete().eq("clinic_id", clinicId).eq("name", name)
    setMasterCategories(prev => prev.filter(c => c !== name))
    if (categoryFilter === name) setCategoryFilter("すべて")
  }

  async function fetchAll(cid?: string) {
    const clinicIdToUse = cid || clinicId
    const logsQuery = supabase.from("inventory_logs")
      .select("*").order("occurred_at", { ascending: false }).limit(500)
    if (clinicIdToUse) logsQuery.eq("clinic_id", clinicIdToUse)

    const [{ data: itemsData }, { data: logsData }] = await Promise.all([
      supabase.from("clinic_inventory_items")
        .select("id,product_name,maker,barcode,stock_quantity,min_stock,category,shelf_no,location,supplier,units_per_package,product_id,unit,stock_unit,clinic_id,created_at,item_image_url")
        .eq("clinic_id", clinicIdToUse)
        .order("product_name"),
      logsQuery,
    ])
    setItems((itemsData as Item[]) || [])
    setLogs((logsData as Log[]) || [])
  }

  function showToast(msg: string, undo?: () => void) {
    setToast(msg)
    setUndoAction(undo ? () => undo : null)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { setToast(null); setUndoAction(null) }, 4000)
  }

  async function updateStock(item: Item, delta: number, type?: string) {
    if (processingId) return
    const newQty = Math.max(0, item.stock_quantity + delta)
    setProcessingId(item.id)

    await supabase.from("clinic_inventory_items").update({ stock_quantity: newQty }).eq("id", item.id)
    await supabase.from("inventory_logs").insert([{
      clinic_id: clinicId || null,
      item_id: item.id,
      product_name: item.product_name,
      change_type: type ?? (delta < 0 ? "使用" : "補充"),
      quantity: Math.abs(delta),
      stock_before: item.stock_quantity,
      stock_after: newQty,
      staff_name: staffName || null,
      occurred_at: new Date().toISOString(),
    }])

    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, stock_quantity: newQty } : i))

    setFlashId(item.id)
    setTimeout(() => setFlashId(null), 600)

    const logsQuery = supabase.from("inventory_logs")
      .select("*").order("occurred_at", { ascending: false }).limit(500)
    if (clinicId) logsQuery.eq("clinic_id", clinicId)
    const { data: logsData } = await logsQuery
    setLogs((logsData as Log[]) || [])
    setProcessingId(null)
  }

  async function confirmAction() {
    if (!actionModal) return
    const { item, type, qty } = actionModal
    if (qty <= 0) { setActionModal(null); return }
    setActionModal(null)
    const delta = type === "use" ? -qty : qty
    await updateStock(item, delta)
    showToast(
      type === "use" ? `✓ 使用 -${qty} 記録しました` : `✓ 補充 +${qty} 記録しました`,
      async () => { await updateStock(item, -delta, "取り消し"); showToast("↩ 取り消しました") }
    )
  }

  async function quickUpdate(item: Item, delta: number) {
    await updateStock(item, delta)
    showToast(
      delta < 0 ? `✓ 使用 -${Math.abs(delta)} 記録しました` : `✓ 補充 +${delta} 記録しました`,
      async () => { await updateStock(item, -delta, "取り消し"); showToast("↩ 取り消しました") }
    )
  }

  function startEditStock(item: Item) {
    setEditMinId(null)
    setEditStockId(item.id)
    setEditStockValue(String(item.stock_quantity))
  }

  function startEditMin(item: Item) {
    setEditStockId(null)
    setEditMinId(item.id)
    setEditMinValue(item.min_stock != null ? String(item.min_stock) : "")
  }

  async function confirmEditMin(item: Item) {
    const newMin = editMinValue.trim() === "" ? null : parseInt(editMinValue, 10)
    setEditMinId(null)
    if (newMin === item.min_stock || (newMin === null && item.min_stock === null)) return
    if (newMin !== null && isNaN(newMin)) return
    await supabase.from("clinic_inventory_items").update({ min_stock: newMin }).eq("id", item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, min_stock: newMin } : i))
    showToast(`✓ 最低在庫数を ${newMin ?? "なし"} に更新しました`)
  }
  async function confirmEditStock(item: Item) {
    const newQty = parseInt(editStockValue, 10)
    setEditStockId(null)
    if (isNaN(newQty) || newQty === item.stock_quantity) return
    const delta = newQty - item.stock_quantity
    await updateStock(item, delta, "棚卸調整")
    showToast(`✓ 在庫を ${item.stock_quantity} → ${newQty} に修正しました`)
  }

  async function addItem() {
    if (!addForm.product_name.trim()) { alert("商品名を入力してください"); return }
    setAddSaving(true)
    const { data: newItem, error } = await supabase.from("clinic_inventory_items").insert({
      clinic_id:         clinicId,
      product_name:      addForm.product_name.trim(),
      maker:             addForm.maker.trim() || null,
      barcode:           addForm.barcode.trim() || null,
      stock_quantity:    parseInt(addForm.stock_quantity, 10) || 0,
      min_stock:         addForm.min_stock !== "" ? (parseInt(addForm.min_stock, 10) || null) : null,
      location:          addForm.location.trim() || null,
      shelf_no:          addForm.shelf_no.trim() || null,
      supplier:          addForm.supplier.trim() || null,
      category:          addForm.category.trim() || null,
      units_per_package: addForm.units_per_package !== "" ? (parseInt(addForm.units_per_package, 10) || null) : null,
      product_id:        addForm.product_id || null,
      unit:              addForm.unit.trim() || null,
      stock_unit:        addForm.stock_unit.trim() || null,
    }).select("id,product_name,maker,barcode,stock_quantity,min_stock,category,shelf_no,location,supplier,units_per_package,product_id,unit,stock_unit,clinic_id,created_at,item_image_url").single()
    if (error) { alert("エラー: " + error.message); setAddSaving(false); return }
    // 全件再取得せず、挿入行を直接リストに追加（ソート維持）
    setItems(prev => [...prev, newItem as Item].sort((a, b) => a.product_name.localeCompare(b.product_name, "ja")))
    setAddModal(false)
    setAddForm({ product_name: "", maker: "", barcode: "", stock_quantity: "0", min_stock: "", location: "", shelf_no: "", supplier: "", category: "", units_per_package: "", product_id: "", unit: "", stock_unit: "" })
    setProductSuggestions([])
    setShowSuggestions(false)
    showToast("✓ 商品を追加しました")
    setAddSaving(false)
  }

  function openEditItem(item: Item) {
    setOptionsMenu(null)
    setEditItemForm({
      product_name:      item.product_name,
      maker:             item.maker || "",
      barcode:           item.barcode || "",
      min_stock:         item.min_stock != null ? String(item.min_stock) : "",
      location:          item.location || "",
      shelf_no:          item.shelf_no || "",
      supplier:          item.supplier || "",
      category:          item.category || "",
      units_per_package: item.units_per_package != null ? String(item.units_per_package) : "",
      unit:              item.unit || "",
      stock_unit:        item.stock_unit || "",
    })
    setEditItemModal(item)
  }

  async function saveEditItem() {
    if (!editItemModal) return
    if (!editItemForm.product_name.trim()) { alert("商品名を入力してください"); return }
    setEditItemSaving(true)
    const { error } = await supabase.from("clinic_inventory_items").update({
      product_name:      editItemForm.product_name.trim(),
      maker:             editItemForm.maker.trim() || null,
      barcode:           editItemForm.barcode.trim() || null,
      min_stock:         editItemForm.min_stock !== "" ? (parseInt(editItemForm.min_stock, 10) || null) : null,
      location:          editItemForm.location.trim() || null,
      shelf_no:          editItemForm.shelf_no.trim() || null,
      supplier:          editItemForm.supplier.trim() || null,
      category:          editItemForm.category.trim() || null,
      units_per_package: editItemForm.units_per_package !== "" ? (parseInt(editItemForm.units_per_package, 10) || null) : null,
      unit:              editItemForm.unit.trim() || null,
      stock_unit:        editItemForm.stock_unit.trim() || null,
    }).eq("id", editItemModal.id)
    if (error) { alert("エラー: " + error.message); setEditItemSaving(false); return }
    setItems(prev => prev.map(i => i.id === editItemModal.id ? {
      ...i,
      product_name:      editItemForm.product_name.trim(),
      maker:             editItemForm.maker.trim() || null,
      barcode:           editItemForm.barcode.trim() || null,
      min_stock:         editItemForm.min_stock !== "" ? (parseInt(editItemForm.min_stock, 10) || null) : null,
      location:          editItemForm.location.trim() || null,
      shelf_no:          editItemForm.shelf_no.trim() || null,
      supplier:          editItemForm.supplier.trim() || null,
      category:          editItemForm.category.trim() || null,
      units_per_package: editItemForm.units_per_package !== "" ? (parseInt(editItemForm.units_per_package, 10) || null) : null,
      unit:              editItemForm.unit.trim() || null,
      stock_unit:        editItemForm.stock_unit.trim() || null,
    } : i))
    setEditItemModal(null)
    showToast("✓ 商品情報を更新しました")
    setEditItemSaving(false)
  }

  async function deleteItem(id: string, name: string) {
    if (!confirm(`「${name}」を在庫リストから削除しますか？`)) return
    await supabase.from("clinic_inventory_items").delete().eq("id", id)
    setItems(prev => prev.filter(i => i.id !== id))
    showToast("✓ 削除しました")
  }

  function openPhotoCapture(item: Item) {
    setOptionsMenu(null)
    photoTargetId.current = item.id
    photoInputRef.current?.click()
  }

  async function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !photoTargetId.current) return
    const itemId = photoTargetId.current
    setUploadingPhotoId(itemId)
    const form = new FormData()
    form.append("file", file)
    form.append("itemId", itemId)
    try {
      const res = await fetch("/api/clinic/upload-item-image", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok) { alert("アップロード失敗: " + json.error); return }
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, item_image_url: json.publicUrl } : i))
      showToast("✅ 写真を保存しました")
    } catch {
      alert("通信エラーが発生しました")
    } finally {
      setUploadingPhotoId(null)
      photoTargetId.current = null
      if (photoInputRef.current) photoInputRef.current.value = ""
    }
  }

  async function deletePhoto(item: Item) {
    if (!item.item_image_url) return
    if (!confirm(`「${item.product_name}」の写真を削除しますか？`)) return
    setUploadingPhotoId(item.id)
    try {
      const res = await fetch("/api/clinic/delete-item-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      })
      if (!res.ok) { const j = await res.json(); alert("削除失敗: " + j.error); return }
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, item_image_url: null } : i))
      showToast("✓ 写真を削除しました")
    } catch {
      alert("通信エラーが発生しました")
    } finally {
      setUploadingPhotoId(null)
    }
  }

  async function bulkDelete() {
    if (bulkSelected.size === 0) return
    if (!confirm(`選択した ${bulkSelected.size} 件を削除しますか？\nこの操作は取り消せません。`)) return
    setBulkDeleting(true)
    const ids = Array.from(bulkSelected)
    const { error } = await supabase.from("clinic_inventory_items").delete().in("id", ids)
    if (error) { alert("エラー: " + error.message); setBulkDeleting(false); return }
    setItems(prev => prev.filter(i => !bulkSelected.has(i.id)))
    setBulkSelected(new Set())
    setBulkDeleteMode(false)
    setBulkDeleting(false)
    showToast(`✓ ${ids.length}件を削除しました`)
  }

  function toggleBulkSelect(id: string) {
    setBulkSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleBulkSelectAll() {
    if (bulkSelected.size === filtered.length) {
      setBulkSelected(new Set())
    } else {
      setBulkSelected(new Set(filtered.map(i => i.id)))
    }
  }

  function normalizeQuery(q: string): string[] {
    const HANK: Record<string, string> = {
      'ヲ':'ｦ','ァ':'ｧ','ィ':'ｨ','ゥ':'ｩ','ェ':'ｪ','ォ':'ｫ','ャ':'ｬ','ュ':'ｭ','ョ':'ｮ','ッ':'ｯ','ー':'ｰ',
      'ア':'ｱ','イ':'ｲ','ウ':'ｳ','エ':'ｴ','オ':'ｵ','カ':'ｶ','キ':'ｷ','ク':'ｸ','ケ':'ｹ','コ':'ｺ',
      'サ':'ｻ','シ':'ｼ','ス':'ｽ','セ':'ｾ','ソ':'ｿ','タ':'ﾀ','チ':'ﾁ','ツ':'ﾂ','テ':'ﾃ','ト':'ﾄ',
      'ナ':'ﾅ','ニ':'ﾆ','ヌ':'ﾇ','ネ':'ﾈ','ノ':'ﾉ','ハ':'ﾊ','ヒ':'ﾋ','フ':'ﾌ','ヘ':'ﾍ','ホ':'ﾎ',
      'マ':'ﾏ','ミ':'ﾐ','ム':'ﾑ','メ':'ﾒ','モ':'ﾓ','ヤ':'ﾔ','ユ':'ﾕ','ヨ':'ﾖ',
      'ラ':'ﾗ','リ':'ﾘ','ル':'ﾙ','レ':'ﾚ','ロ':'ﾛ','ワ':'ﾜ','ン':'ﾝ','゛':'ﾞ','゜':'ﾟ','・':'･',
      'ガ':'ｶﾞ','ギ':'ｷﾞ','グ':'ｸﾞ','ゲ':'ｹﾞ','ゴ':'ｺﾞ','ザ':'ｻﾞ','ジ':'ｼﾞ','ズ':'ｽﾞ','ゼ':'ｾﾞ','ゾ':'ｿﾞ',
      'ダ':'ﾀﾞ','ヂ':'ﾁﾞ','ヅ':'ﾂﾞ','デ':'ﾃﾞ','ド':'ﾄﾞ','バ':'ﾊﾞ','ビ':'ﾋﾞ','ブ':'ﾌﾞ','ベ':'ﾍﾞ','ボ':'ﾎﾞ',
      'パ':'ﾊﾟ','ピ':'ﾋﾟ','プ':'ﾌﾟ','ペ':'ﾍﾟ','ポ':'ﾎﾟ','ヴ':'ｳﾞ',
    }
    const ZENK: Record<string, string> = Object.fromEntries(Object.entries(HANK).map(([k,v])=>[v,k]))

    const toZenkaku  = (s: string) => s.replace(/[･-ﾟ]{1,2}/g, c => ZENK[c] || c)
    const toHankaku  = (s: string) => s.replace(/[ァ-ヴ・]/g,  c => HANK[c] || c)
    const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
    const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))

    const zen  = toZenkaku(q)
    const kata = toKatakana(zen)
    const hira = toHiragana(zen)
    const hank = toHankaku(kata)
    return Array.from(new Set([q, zen, kata, hira, hank].filter(Boolean)))
  }

  async function searchProducts(q: string) {
    if (!q.trim() || q.length < 1) { setProductSuggestions([]); setShowSuggestions(false); return }
    const variants = normalizeQuery(q.trim())
    const orFilter = variants.map(v => `name.ilike.%${v}%`).join(",")
    const { data } = await supabase.from("products")
      .select("id,name,manufacturer")
      .or(orFilter)
      .limit(10)
    setProductSuggestions((data as any[]) || [])
    setShowSuggestions(true)
  }

  function selectProduct(p: { id: string; name: string; manufacturer: string | null }) {
    setAddForm(f => ({ ...f, product_name: p.name, maker: p.manufacturer || "", product_id: p.id }))
    setShowSuggestions(false)
    setProductSuggestions([])
  }

  function exportCSV() {
    if (items.length === 0) { alert("在庫データがありません"); return }
    const csv = toCSV(items.map(i => ({
      商品名:     i.product_name,
      メーカー:   i.maker || "",
      注文先:     (i as any).supplier || "",
      バーコード: i.barcode || "",
      現在在庫数: i.stock_quantity,
      最低在庫数: i.min_stock ?? "",
      場所:       i.location || "",
      棚番号:     i.shelf_no || "",
    })), ["商品名", "メーカー", "注文先", "バーコード", "現在在庫数", "最低在庫数", "場所", "棚番号"])
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}`
    downloadCSV(`在庫リスト_${stamp}.csv`, csv)
  }

  function downloadTemplate() {
    const csv = toCSV([
      { 商品名: "グローブM", メーカー: "ニチバン", 注文先: "モリタ", バーコード: "", 初期在庫数: 10, 最低在庫数: 3, 場所: "処置室", 棚番号: "A-1" },
      { 商品名: "マスク", メーカー: "", 注文先: "", バーコード: "", 初期在庫数: 50, 最低在庫数: 10, 場所: "処置室", 棚番号: "" },
    ], ["商品名", "メーカー", "注文先", "バーコード", "初期在庫数", "最低在庫数", "場所", "棚番号"])
    downloadCSV("在庫インポートテンプレート.csv", csv)
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseCSV(text).filter(r => r["商品名"]?.trim())
      setImportRows(rows)
      setImportModal(true)
    }
    reader.readAsText(file, "UTF-8")
    e.target.value = ""
  }

  async function importItems() {
    if (importing || importRows.length === 0) return
    setImporting(true)

    if (importMode === "update") {
      // 商品名で照合して場所・棚番号などを更新
      let updated = 0, notFound = 0
      for (const r of importRows) {
        const name = r["商品名"]?.trim()
        if (!name) continue
        const match = items.find(i => i.product_name === name)
        if (!match) { notFound++; continue }
        const patch: Record<string, any> = {}
        if (r["場所"]    !== undefined) patch.location  = r["場所"]?.trim()    || null
        if (r["棚番号"]  !== undefined) patch.shelf_no  = r["棚番号"]?.trim()  || null
        if (r["注文先"]  !== undefined) patch.supplier  = r["注文先"]?.trim()  || null
        if (r["最低在庫数"] !== undefined && r["最低在庫数"].trim())
          patch.min_stock = parseInt(r["最低在庫数"], 10) || null
        if (r["メーカー"] !== undefined && r["メーカー"].trim())
          patch.maker = r["メーカー"].trim()
        if (r["バーコード"] !== undefined && r["バーコード"].trim())
          patch.barcode = r["バーコード"].trim()
        await supabase.from("clinic_inventory_items").update(patch).eq("id", match.id)
        updated++
      }
      setImportModal(false)
      setImportRows([])
      await fetchAll(clinicId)
      showToast(`✓ ${updated}件を更新しました${notFound > 0 ? `（${notFound}件は商品名が一致せず）` : ""}`)
    } else {
      const records = importRows.map(r => ({
        product_name:   r["商品名"]?.trim() || "",
        maker:          r["メーカー"]?.trim() || null,
        supplier:       r["注文先"]?.trim() || null,
        barcode:        r["バーコード"]?.trim() || null,
        stock_quantity: parseInt(r["初期在庫数"] || r["現在在庫数"] || "0", 10) || 0,
        min_stock:      r["最低在庫数"]?.trim() ? (parseInt(r["最低在庫数"], 10) || null) : null,
        location:       r["場所"]?.trim() || null,
        shelf_no:       r["棚番号"]?.trim() || null,
      }))
      const { error } = await supabase.from("clinic_inventory_items").insert(records)
      if (error) { alert("エラー: " + error.message); setImporting(false); return }
      setImportModal(false)
      setImportRows([])
      await fetchAll(clinicId)
      showToast(`✓ ${records.length}件をインポートしました`)
    }
    setImporting(false)
  }

  async function startScan() {
    setScanning(true)
    const scanner = new Html5Qrcode("inv-reader")
    try {
      await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 },
        async (code) => {
          await scanner.stop()
          setScanning(false)
          let found: Item | undefined
          if (code.startsWith("inv:")) {
            found = items.find((i) => i.id === code.slice(4))
          } else {
            found = items.find((i) => String(i.barcode || "") === code)
              || items.find((i) => i.product_name === code)
          }
          if (!found) { playBeep("error"); alert("商品が見つかりません"); return }
          playBeep("success")
          setActionModal({ item: found, type: "use", qty: 1 })
          itemRefs.current[found.id]?.scrollIntoView({ behavior: "smooth", block: "center" })
        }, () => {})
    } catch { setScanning(false) }
  }

  // 連続スキャンモード：setScanning→再レンダー後にuseEffectでスキャナー起動
  function startBatchScan() {
    setScanning(true)
    setScannerReady(true) // useEffectがdiv表示後に起動する
  }

  async function stopBatchScan() {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop()
        await scannerRef.current.clear()
      }
    } catch {}
    scannerRef.current = null
    setScanning(false)
    // カートに商品があれば全画面カートを自動表示
    setScanCartOpen(prev => prev || true)
  }

  async function commitScanCart() {
    if (scanCart.length === 0) return
    setBatchProcessing(true)
    const snapshot = [...scanCart]
    for (const { item, qty } of snapshot) {
      await updateStock(item, -qty)
    }
    const total = snapshot.reduce((s, e) => s + e.qty, 0)
    setScanCart([])
    setScanCartOpen(false)
    setBatchProcessing(false)
    showToast(`✓ ${snapshot.length}品目・計${total}点の使用を記録しました`)
  }

  const norm = (v: any) => String(v || "")
    .toLowerCase()
    .normalize("NFKC")                                                          // 全角英数→半角、半角カタカナ→全角カタカナ
    .replace(/[ァ-ヶ]/g, s => String.fromCharCode(s.charCodeAt(0) - 0x60)) // カタカナ→ひらがな
    .replace(/\s+/g, "")

  // カテゴリ一覧（マスター＋未登録分をマージ）
  const categories = useMemo(() => {
    const fromItems = items.map((i) => i.category).filter(Boolean) as string[]
    const merged = Array.from(new Set([...masterCategories, ...fromItems]))
    return ["すべて", ...merged]
  }, [masterCategories, items])

  // 場所一覧
  const locations = useMemo(() => {
    const locs = items.map((i) => i.location).filter(Boolean) as string[]
    return ["すべて", ...Array.from(new Set(locs)).sort()]
  }, [items])

  const filtered = useMemo(() => {
    const k = norm(search)
    return items.filter((i) => {
      const matchSearch = !k ||
        norm(i.product_name).includes(k) ||
        norm(i.maker || "").includes(k) ||
        norm(i.barcode || "").includes(k) ||
        norm(i.location || "").includes(k) ||
        norm(i.shelf_no || "").includes(k) ||
        norm(i.category || "").includes(k)
      const matchLoc = locationFilter === "すべて" || i.location === locationFilter
      const matchCat = categoryFilter === "すべて" || i.category === categoryFilter
      return matchSearch && matchLoc && matchCat
    })
  }, [items, search, locationFilter, categoryFilter])

  // units_per_package が設定されている場合、stock_quantity×units_per_package で本数換算して比較
  function effectiveStock(i: Item) {
    return i.units_per_package ? i.stock_quantity * i.units_per_package : i.stock_quantity
  }

  const needsReorder = useMemo(() =>
    filtered.filter((i) => i.min_stock !== null && effectiveStock(i) <= i.min_stock), [filtered])

  const normalItems = useMemo(() =>
    filtered.filter((i) => !(i.min_stock !== null && effectiveStock(i) <= i.min_stock)), [filtered])

  // 場所別グループ（すべて表示時のみ）
  const locationGroups = useMemo(() => {
    if (locationFilter !== "すべて") return null
    const order: string[] = []
    const map: Record<string, Item[]> = {}
    for (const item of normalItems) {
      const key = item.location || "（場所未設定）"
      if (!map[key]) { map[key] = []; order.push(key) }
      map[key].push(item)
    }
    return order.map((loc) => ({ loc, items: map[loc] }))
  }, [normalItems, locationFilter])

  const staffNames = useMemo(() => {
    const names = logs.map((l) => l.staff_name).filter(Boolean) as string[]
    return ["すべて", ...Array.from(new Set(names))]
  }, [logs])

  const filteredLogs = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 6)
    return logs.filter((l) => {
      const d = new Date(l.occurred_at)
      const matchTime = historyFilter === "today" ? d >= todayStart
        : historyFilter === "week" ? d >= weekStart : true
      const matchStaff = staffFilter === "すべて" || l.staff_name === staffFilter
      return matchTime && matchStaff
    })
  }, [logs, historyFilter, staffFilter])

  function fmtTime(str: string) {
    const d = new Date(str)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  function fmtDateShort(str: string) {
    const d = new Date(str)
    return d.toDateString() === new Date().toDateString()
      ? fmtTime(str) : `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(str)}`
  }

  const itemCardProps = (item: Item) => ({
    item,
    onQuick: quickUpdate,
    onOpenModal: (item: Item, type: "use" | "restock") => setActionModal({ item, type, qty: type === "restock" ? (item.units_per_package ?? 1) : 1 }),
    onFocusModal: (item: Item, type: "use" | "restock") => setFocusModal({ item, type }),
    onOpenOptions: (item: Item) => setOptionsMenu(item),
    onOrder: (item: Item) => {
      const qty = item.units_per_package ?? 1
      router.push(`/order?order_product_id=${item.product_id}&order_qty=${qty}`)
    },
    onEditStock: startEditStock,
    editStockId,
    editStockValue,
    setEditStockValue,
    onConfirmEdit: confirmEditStock,
    onCancelEdit: () => setEditStockId(null),
    onEditMin: startEditMin,
    editMinId,
    editMinValue,
    setEditMinValue,
    onConfirmEditMin: confirmEditMin,
    onCancelEditMin: () => setEditMinId(null),
    onDelete: deleteItem,
    processing: processingId === item.id,
    flash: flashId === item.id,
    setRef: (el: HTMLDivElement | null) => { itemRefs.current[item.id] = el },
    bulkDeleteMode,
    bulkSelected: bulkSelected.has(item.id),
    onBulkToggle: toggleBulkSelect,
    onPhotoCapture: openPhotoCapture,
    onDeletePhoto: deletePhoto,
    uploadingPhoto: uploadingPhotoId === item.id,
  })

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: C.sub }}>
      読み込み中…
    </div>
  )

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", background: C.bg, minHeight: "100vh", paddingBottom: 72 }}>
      <style>{`
        .inv-btn:active { opacity: 0.7; transform: scale(0.97); }
        @keyframes flash { 0%,100%{background:transparent} 40%{background:#bbf7d0} }
        .flash-anim { animation: flash 0.6s ease; }
        .cat-pills::-webkit-scrollbar { display: none; }
        .cat-pills { -ms-overflow-style: none; scrollbar-width: none; }
        .cat-pills-wrap { position: relative; }
        .cat-pills-wrap::after {
          content: "";
          position: absolute;
          top: 0; right: 0; bottom: 0;
          width: 40px;
          background: linear-gradient(to right, transparent, #f8f9fa);
          pointer-events: none;
          border-radius: 0 8px 8px 0;
        }
      `}</style>

      {toast && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          background: "#1a1a1a", color: "#fff", padding: "10px 16px", borderRadius: 999,
          fontSize: 13, fontWeight: "bold", zIndex: 999, whiteSpace: "nowrap",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 12,
        }}>
          <span>{toast}</span>
          {undoAction && (
            <button onClick={() => { setToast(null); setUndoAction(null); if (toastTimer.current) clearTimeout(toastTimer.current); undoAction() }}
              style={{ background: "#fff", color: "#1a1a1a", border: "none", borderRadius: 999, padding: "4px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer" }}>
              取り消し
            </button>
          )}
        </div>
      )}

      {/* ヘッダー */}
      <div style={{
        background: C.card, padding: "12px 14px 10px",
        borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => router.push("/menu")} style={{
              background: "#e8f5ec", color: C.primary, border: "1px solid #b2dfbd",
              borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: "bold", cursor: "pointer",
            }}>← メニュー</button>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: "bold", color: C.text }}>
              {tab === "record" ? "在庫記録" : "出し入れ履歴"}
            </h1>
          </div>
          {tab === "record" && needsReorder.length > 0 && (
            <span style={{ background: "#fee2e2", color: "#b91c1c", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: "bold" }}>
              発注必要 {needsReorder.length}件
            </span>
          )}
          {tab === "record" && (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => router.push("/inventory/stocktake")} style={{
                background: "#fff", color: C.orange, border: `1.5px solid ${C.orange}`,
                borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer",
              }}>📋 棚卸し</button>
              <button onClick={() => router.push("/inventory/labels")} style={{
                background: "#fff", color: "#7c3aed", border: "1.5px solid #7c3aed",
                borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer",
              }}>🏷 ラベル</button>
              <button onClick={() => router.push("/inventory/import")} style={{
                background: "#fff", color: "#0891b2", border: "1.5px solid #0891b2",
                borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer",
              }}>📦 一括登録</button>
              <button onClick={exportCSV} style={{
                background: "#fff", color: C.sub, border: `1.5px solid ${C.border}`,
                borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer",
              }}>📤</button>
              <button onClick={() => { setImportMode("insert"); csvInputRef.current?.click() }} style={{
                background: "#fff", color: C.blue, border: `1.5px solid ${C.blue}`,
                borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer",
              }}>📥 CSV</button>
              <button onClick={() => { setBulkDeleteMode(m => !m); setBulkSelected(new Set()) }} style={{
                background: bulkDeleteMode ? "#fee2e2" : "#fff",
                color: bulkDeleteMode ? C.red : C.sub,
                border: `1.5px solid ${bulkDeleteMode ? C.red : C.border}`,
                borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer",
              }}>{bulkDeleteMode ? "✕ キャンセル" : "🗑 一括削除"}</button>
              <button onClick={() => setAddModal(true)} style={{
                background: C.primary, color: "#fff", border: "none",
                borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: "bold", cursor: "pointer",
              }}>＋ 追加</button>
              <input ref={csvInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCsvFile} />
            </div>
          )}
        </div>

        {tab === "record" && (
          <>
            {!scanning && (
              <div style={{ display: "flex", gap: 6, marginBottom: 9 }}>
                <button className="inv-btn" onClick={startScan} style={{
                  flex: 1, padding: "11px 0", borderRadius: 9, background: C.blue, color: "#fff",
                  border: "none", fontWeight: "bold", fontSize: 14, cursor: "pointer",
                }}>📷 スキャン</button>
                <button className="inv-btn" onClick={startBatchScan} style={{
                  flex: 2, padding: "11px 0", borderRadius: 9,
                  background: "#7c3aed", color: "#fff",
                  border: "none", fontWeight: "bold", fontSize: 14, cursor: "pointer",
                }}>🔄 連続スキャン</button>
              </div>
            )}
            <button onClick={() => setSearchFocused(true)}
              style={{ width: "100%", padding: "10px 13px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 14, background: "#f9fafb", color: search ? C.text : C.sub, textAlign: "left", cursor: "pointer", marginBottom: 8, boxSizing: "border-box" }}>
              🔍 {search || "商品名・バーコードで検索"}
            </button>
            {/* カテゴリフィルター */}
            <div className="cat-pills-wrap" style={{ marginBottom: 4 }}>
            <div className="cat-pills" style={{ display: "flex", overflowX: "auto", gap: 6, paddingBottom: 4, alignItems: "center" }}>
              {categories.map((cat) => (
                <button key={cat} onClick={() => setCategoryFilter(cat)} style={{
                  whiteSpace: "nowrap", padding: "5px 12px", borderRadius: 999, fontSize: 12,
                  cursor: "pointer", border: "none", fontWeight: categoryFilter === cat ? "bold" : "normal",
                  background: categoryFilter === cat ? "#7c3aed" : "#f3f4f6",
                  color: categoryFilter === cat ? "#fff" : C.sub,
                }}>{cat === "すべて" ? "🏷 すべて" : cat}</button>
              ))}
              <button onClick={() => setCatMgmtModal(true)} style={{
                whiteSpace: "nowrap", padding: "5px 10px", borderRadius: 999, fontSize: 12,
                cursor: "pointer", border: "1.5px dashed #d1d5db", background: "#fff", color: C.sub, flexShrink: 0,
              }}>＋ 管理</button>
            </div>
            </div>
            {/* 場所フィルター：非表示 */}
          </>
        )}

        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {(["today", "week", "all"] as const).map((f) => (
                <button key={f} onClick={() => setHistoryFilter(f)} style={{
                  padding: "6px 14px", borderRadius: 999, fontSize: 13, cursor: "pointer", border: "none",
                  fontWeight: historyFilter === f ? "bold" : "normal",
                  background: historyFilter === f ? C.blue : "#f3f4f6",
                  color: historyFilter === f ? "#fff" : C.sub,
                }}>{f === "today" ? "今日" : f === "week" ? "今週" : "すべて"}</button>
              ))}
            </div>
            {staffNames.length > 2 && (
              <div className="cat-pills" style={{ display: "flex", overflowX: "auto", gap: 6 }}>
                {staffNames.map((s) => (
                  <button key={s} onClick={() => setStaffFilter(s)} style={{
                    whiteSpace: "nowrap", padding: "5px 12px", borderRadius: 999, fontSize: 12,
                    cursor: "pointer", border: "none", fontWeight: staffFilter === s ? "bold" : "normal",
                    background: staffFilter === s ? C.primary : "#f3f4f6",
                    color: staffFilter === s ? "#fff" : C.sub,
                  }}>{s === "すべて" ? "全スタッフ" : s}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* inv-reader: 1つだけDOMに存在。scanning時はfixed fullscreen */}
      <div id="inv-reader" style={{
        display: scanning ? "block" : "none",
        position: "fixed", inset: 0, zIndex: 500, background: "#000",
        width: "100%", height: "100%",
      }} />

      {/* カメラ操作UI（inv-readerの上にオーバーレイ） */}
      {scanning && (
        <>
          <div style={{ position: "fixed", top: 16, left: 0, right: 0, zIndex: 510, display: "flex", justifyContent: "center" }}>
            <button onClick={stopBatchScan} style={{
              background: "rgba(220,38,38,0.92)", color: "#fff", border: "none",
              borderRadius: 999, padding: "10px 28px", fontSize: 15, fontWeight: "bold", cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}>⏹ スキャン停止</button>
          </div>
          {scanCart.length > 0 && (
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 510,
              background: "rgba(124,58,237,0.92)", color: "#fff",
              padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ fontWeight: "bold", fontSize: 14 }}>
                🛒 {scanCart.length}品目・計{scanCart.reduce((s, e) => s + e.qty, 0)}点 スキャン済み
              </span>
              <span style={{ fontSize: 12, opacity: 0.85 }}>停止後に確認・使用</span>
            </div>
          )}
        </>
      )}

      {/* ── 記録タブ ── */}
      {tab === "record" && (
        <div style={{ padding: "10px 10px 0" }}>

          {/* 一括削除モード：全選択バー */}
          {bulkDeleteMode && (
            <div style={{
              background: "#fff3cd", border: "1.5px solid #ffc107", borderRadius: 10,
              padding: "10px 14px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, fontWeight: "bold", color: "#856404" }}>
                <input type="checkbox"
                  checked={filtered.length > 0 && bulkSelected.size === filtered.length}
                  onChange={toggleBulkSelectAll}
                  style={{ width: 18, height: 18, cursor: "pointer" }} />
                全選択（{filtered.length}件中 {bulkSelected.size}件選択中）
              </label>
              <span style={{ fontSize: 12, color: "#856404" }}>チェックして削除</span>
            </div>
          )}

          {/* 発注必要セクション */}
          {needsReorder.length > 0 && (
            <section style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: "bold", color: "#b91c1c" }}>発注必要</span>
                  <span style={{ background: C.red, color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 11, fontWeight: "bold" }}>{needsReorder.length}</span>
                </div>
                <button onClick={() => router.push("/order")} style={{
                  padding: "5px 12px", borderRadius: 8, background: C.orange, color: "#fff",
                  border: "none", fontSize: 12, fontWeight: "bold", cursor: "pointer",
                }}>注文画面へ →</button>
              </div>
              {needsReorder.map((item) => <ItemCard key={item.id} {...itemCardProps(item)} />)}
            </section>
          )}

          {/* 場所別グループ表示（すべて選択時） */}
          {locationFilter === "すべて" && locationGroups ? (
            locationGroups.length === 0 ? null : (
              locationGroups.map(({ loc, items: groupItems }) => (
                <section key={loc} style={{ marginBottom: 16 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                    padding: "6px 10px", background: "#f0fdf4", borderRadius: 8,
                    border: "1px solid #bbf7d0",
                  }}>
                    <span style={{ fontSize: 13 }}>📍</span>
                    <span style={{ fontSize: 13, fontWeight: "bold", color: C.primary }}>
                      {loc}
                    </span>
                    <span style={{ fontSize: 12, color: C.sub, marginLeft: "auto" }}>
                      {groupItems.length}点
                    </span>
                  </div>
                  {groupItems.map((item) => <ItemCard key={item.id} {...itemCardProps(item)} />)}
                </section>
              ))
            )
          ) : (
            /* 場所指定フィルター時は単純リスト */
            <>
              {normalItems.map((item) => <ItemCard key={item.id} {...itemCardProps(item)} />)}
            </>
          )}

          {filtered.length === 0 && (
            <div style={{ textAlign: "center", color: C.sub, padding: "60px 0", fontSize: 14 }}>商品が見つかりません</div>
          )}
        </div>
      )}

      {/* ── 履歴タブ ── */}
      {tab === "history" && (
        <div style={{ padding: "10px 10px 0" }}>
          {filteredLogs.length === 0 ? (
            <div style={{ textAlign: "center", color: C.sub, padding: "60px 0", fontSize: 14 }}>記録がありません</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {filteredLogs.map((log) => {
                const isUse = log.change_type === "使用"
                const isAdj = log.change_type === "棚卸調整"
                const iconColor = isAdj ? C.orange : isUse ? "#b91c1c" : "#166534"
                const bgColor   = isAdj ? "#fff7e6" : isUse ? "#fee2e2" : "#e8f5ec"
                return (
                  <div key={log.id} style={{
                    background: C.card, borderRadius: 12, padding: "11px 13px",
                    border: `1px solid ${C.border}`, display: "flex", gap: 11, alignItems: "flex-start",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, marginTop: 1, background: bgColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: iconColor }}>
                      {isAdj ? "⚖" : isUse ? "↓" : "↑"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: C.sub }}>{fmtDateShort(log.occurred_at)}</span>
                        {log.staff_name && <strong style={{ color: C.text, marginLeft: 8, fontSize: 12 }}>{log.staff_name}</strong>}
                      </div>
                      <p style={{ margin: "0 0 5px", fontWeight: "bold", fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {log.product_name}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: "bold", padding: "2px 8px", borderRadius: 999, background: bgColor, color: iconColor }}>
                          {log.change_type} {isAdj ? "" : isUse ? "-" : "+"}{log.quantity}
                        </span>
                        <span style={{ fontSize: 12, color: C.sub }}>
                          在庫 {log.stock_before} → <strong style={{ color: isUse ? C.red : C.primary }}>{log.stock_after}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* カテゴリ管理モーダル */}
      {catMgmtModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setCatMgmtModal(false) }}>
          <div style={{ background: C.card, borderRadius: "20px 20px 0 0", padding: "22px 20px 36px", width: "100%", maxWidth: 520, boxShadow: "0 -4px 24px rgba(0,0,0,0.15)", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: "bold", color: C.text }}>🏷 カテゴリ管理</h2>
              <button onClick={() => setCatMgmtModal(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>✕</button>
            </div>
            {/* 追加フォーム */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addCategory() }}
                placeholder="新しいカテゴリ名（例：消耗品）"
                style={{ flex: 1, padding: "10px 12px", borderRadius: 9, border: `1.5px solid #7c3aed`, fontSize: 14, outline: "none", color: C.text }} />
              <button onClick={addCategory} disabled={catSaving || !newCatName.trim()} style={{
                padding: "10px 16px", borderRadius: 9, border: "none", fontWeight: "bold", fontSize: 14,
                background: !newCatName.trim() ? "#d1d5db" : "#7c3aed", color: "#fff",
                cursor: !newCatName.trim() ? "default" : "pointer",
              }}>追加</button>
            </div>
            {/* カテゴリ一覧 */}
            {masterCategories.length === 0 ? (
              <p style={{ textAlign: "center", color: C.sub, fontSize: 14, padding: "20px 0" }}>カテゴリがまだありません</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {masterCategories.map((cat) => {
                  const count = items.filter(i => i.category === cat).length
                  return (
                    <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#f9fafb" }}>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: "bold", color: C.text }}>{cat}</span>
                      <span style={{ fontSize: 12, color: C.sub }}>{count}品</span>
                      <button onClick={() => deleteCategory(cat)} style={{
                        background: "none", border: "none", color: "#ef4444", fontSize: 18, cursor: "pointer", padding: "0 4px",
                      }}>🗑</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* オプションメニュー（...ボタン） */}
      {optionsMenu && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOptionsMenu(null) }}>
          <div style={{ background: C.card, borderRadius: "20px 20px 0 0", padding: "18px 20px 36px", width: "100%", maxWidth: 520, boxShadow: "0 -4px 24px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: "bold", color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {optionsMenu.product_name}
              </p>
              <button onClick={() => setOptionsMenu(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => { setOptionsMenu(null); setActionModal({ item: optionsMenu, type: "use", qty: 1 }) }} style={{
                padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${C.border}`,
                background: "#f9fafb", color: C.text, fontSize: 15, fontWeight: "bold", cursor: "pointer", textAlign: "left",
              }}>📝 使用 / 補充の数量を指定する</button>
              <button onClick={() => openEditItem(optionsMenu)} style={{
                padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${C.blue}`,
                background: "#eff6ff", color: C.blue, fontSize: 15, fontWeight: "bold", cursor: "pointer", textAlign: "left",
              }}>✏️ 商品情報を編集する</button>
            </div>
          </div>
        </div>
      )}

      {/* 商品情報編集モーダル */}
      {editItemModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditItemModal(null) }}>
          <div style={{ background: C.card, borderRadius: "20px 20px 0 0", padding: "22px 20px 36px", width: "100%", maxWidth: 520, boxShadow: "0 -4px 24px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: "bold", color: C.text }}>✏️ 商品情報を編集</h2>
              <button onClick={() => setEditItemModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { key: "product_name", label: "商品名",    required: true,  placeholder: "" },
                { key: "category",     label: "カテゴリ",  required: false, placeholder: "例）消耗品・麻酔薬" },
                { key: "maker",        label: "メーカー",  required: false, placeholder: "" },
                { key: "supplier",     label: "注文先",    required: false, placeholder: "" },
                { key: "barcode",      label: "バーコード",required: false, placeholder: "" },
                { key: "location",     label: "置き場所",  required: false, placeholder: "例）処置室・棚A" },
                { key: "shelf_no",     label: "在庫場所",  required: false, placeholder: "例）A-1" },
              ].map(({ key, label, required, placeholder }) => (
                <div key={key}>
                  <label style={{ fontSize: 12, color: C.sub }}>{label}{required && <span style={{ color: "#ef4444" }}> *</span>}</label>
                  <input value={(editItemForm as any)[key]} placeholder={placeholder}
                    onChange={e => setEditItemForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }} />
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.sub }}>在庫数の単位（箱・袋など）</label>
                  <input value={editItemForm.stock_unit} placeholder="箱・袋・本"
                    onChange={e => setEditItemForm(f => ({ ...f, stock_unit: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.sub }}>入り数の単位（本・個・枚など）</label>
                  <input value={editItemForm.unit} placeholder="本・個・枚"
                    onChange={e => setEditItemForm(f => ({ ...f, unit: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.sub }}>入数（1{editItemForm.stock_unit || "箱"}あたり）</label>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <input type="number" min={1} value={editItemForm.units_per_package} placeholder="なし"
                    onChange={e => setEditItemForm(f => ({ ...f, units_per_package: e.target.value }))}
                    style={{ flex: 1, padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, boxSizing: "border-box", outline: "none", color: C.text }} />
                  {editItemForm.unit && <span style={{ fontSize: 13, color: C.sub, whiteSpace: "nowrap" }}>{editItemForm.unit}</span>}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.sub }}>
                  最低在庫数
                  {editItemForm.units_per_package
                    ? <span style={{ color: C.orange, marginLeft: 6 }}>※ {editItemForm.unit || "本"}換算（在庫数×入数 ≤ この値で発注アラート）</span>
                    : null}
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <input type="number" min={0} value={editItemForm.min_stock} placeholder="なし"
                    onChange={e => setEditItemForm(f => ({ ...f, min_stock: e.target.value }))}
                    style={{ flex: 1, padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, boxSizing: "border-box", outline: "none", color: C.text }} />
                  {editItemForm.unit && <span style={{ fontSize: 13, color: C.sub, whiteSpace: "nowrap" }}>{editItemForm.unit}</span>}
                </div>
              </div>
            </div>
            <button onClick={saveEditItem} disabled={editItemSaving}
              style={{ width: "100%", marginTop: 20, padding: 14, borderRadius: 12, border: "none", background: editItemSaving ? "#d1d5db" : C.blue, color: "#fff", fontWeight: "bold", fontSize: 16, cursor: editItemSaving ? "default" : "pointer" }}>
              {editItemSaving ? "保存中…" : "保存する"}
            </button>
          </div>
        </div>
      )}

      {/* 全画面検索オーバーレイ */}
      {searchFocused && (
        <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 200, display: "flex", flexDirection: "column" }}>
          {/* 検索バー */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="商品名・バーコードで検索"
              style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: `2px solid ${C.primary}`, fontSize: 16, outline: "none", color: C.text, boxSizing: "border-box" }}
            />
            <button onClick={() => { setSearch(""); setSearchFocused(false) }}
              style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "#f3f4f6", color: C.sub, fontSize: 14, fontWeight: "bold", cursor: "pointer", whiteSpace: "nowrap" }}>
              キャンセル
            </button>
          </div>
          {/* 結果リスト */}
          <div style={{ overflowY: "auto", flex: 1, padding: "8px 10px" }}>
            {(search
              ? items.filter(i =>
                  norm(i.product_name).includes(norm(search)) ||
                  norm(i.maker || "").includes(norm(search)) ||
                  norm(i.barcode || "").includes(norm(search))
                )
              : []
            ).map(item => (
              <button key={item.id} onMouseDown={() => { setSearchFocused(false); document.getElementById(`inv-item-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }) }}
                style={{ width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", marginBottom: 6, cursor: "pointer", display: "block" }}>
                <div style={{ fontWeight: "bold", fontSize: 15, color: C.text }}>{item.product_name}</div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
                  {[item.maker, item.location, item.barcode ? `# ${item.barcode}` : null].filter(Boolean).join("  ·  ")}
                </div>
              </button>
            ))}
            {search && items.filter(i =>
              norm(i.product_name).includes(norm(search)) ||
              norm(i.maker || "").includes(norm(search)) ||
              norm(i.barcode || "").includes(norm(search))
            ).length === 0 && (
              <p style={{ textAlign: "center", color: C.sub, padding: "40px 0" }}>該当する商品がありません</p>
            )}
            {!search && (
              <p style={{ textAlign: "center", color: C.sub, padding: "40px 0", fontSize: 14 }}>商品名を入力してください</p>
            )}
          </div>
        </div>
      )}

      {/* フォーカスモーダル（在庫数タップ） */}
      {focusModal && (() => {
        const { item, type } = focusModal
        const needsReorder = item.min_stock != null && item.stock_quantity <= item.min_stock
        const presets = item.units_per_package
          ? [1, 2, 3, item.units_per_package]
          : [1, 2, 3, 5]
        const accentColor = type === "use" ? "#2563eb" : "#22a648"
        const accentLight = type === "use" ? "#eff6ff" : "#f0fdf4"

        const commitQty = async (qty: number) => {
          if (qty <= 0) return
          setFocusModal(null)
          const delta = type === "use" ? -qty : qty
          await updateStock(item, delta, type === "use" ? "使用" : "補充")
          showToast(
            type === "use" ? `✓ 使用 -${qty} 記録しました` : `✓ 補充 +${qty} 記録しました`,
            async () => { await updateStock(item, -delta, "取り消し"); showToast("↩ 取り消しました") }
          )
        }

        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
            onClick={(e) => { if (e.target === e.currentTarget) setFocusModal(null) }}>
            <div style={{ background: "#fff", width: "100%", maxWidth: 520, borderRadius: "20px 20px 0 0", padding: "18px 16px 32px", boxShadow: "0 -4px 24px rgba(0,0,0,0.15)" }}>

              {/* 商品名・在庫 */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: "bold", fontSize: 15, color: "#1a1a1a" }}>{item.product_name}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    現在 <strong style={{ color: needsReorder ? "#ef4444" : "#1a1a1a", fontSize: 16 }}>{item.stock_quantity}</strong>
                    {item.units_per_package && <span style={{ color: "#9ca3af" }}> {item.stock_unit || "箱"} / {item.stock_quantity * item.units_per_package}{item.unit || "本"}</span>}
                    {item.min_stock != null && <span style={{ color: "#9ca3af" }}>　最低 {item.min_stock}</span>}
                  </div>
                </div>
                <button onClick={() => setFocusModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>✕</button>
              </div>

              {/* 使用/補充 切り替え */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {(["use", "restock"] as const).map(t => (
                  <button key={t} onClick={() => setFocusModal({ item, type: t })} style={{
                    flex: 1, padding: "10px 0", borderRadius: 9, fontWeight: "bold", fontSize: 15, cursor: "pointer",
                    border: `2px solid ${t === "use" ? "#2563eb" : "#22a648"}`,
                    background: type === t ? (t === "use" ? "#2563eb" : "#22a648") : "#fff",
                    color: type === t ? "#fff" : (t === "use" ? "#2563eb" : "#22a648"),
                  }}>{t === "use" ? "使用" : "補充"}</button>
                ))}
              </div>

              {/* 1箱ボタン（入数設定ありの場合のみ、大きく目立つ） */}
              {item.units_per_package && (
                <button onClick={() => commitQty(item.units_per_package!)} style={{
                  width: "100%", padding: "16px 0", borderRadius: 12, marginBottom: 10,
                  border: "2px solid #7c3aed", background: "#7c3aed", color: "#fff",
                  fontSize: 18, fontWeight: "bold", cursor: "pointer", letterSpacing: 1,
                }}>
                  📦 1{item.stock_unit || "箱"} 補充（{item.units_per_package}{item.unit || "本"}）
                </button>
              )}

              {/* プリセット（即確定） */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {[1, 2, 3, 5].map((qty) => (
                  <button key={qty} onClick={() => commitQty(qty)} style={{
                    flex: 1, padding: "14px 0", borderRadius: 10,
                    border: `1.5px solid ${accentColor}`,
                    background: accentLight, color: accentColor,
                    fontSize: 20, fontWeight: "bold", cursor: "pointer",
                  }}>
                    {qty}
                  </button>
                ))}
              </div>

              {/* 数値入力＋確定（キーボード直上） */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number" inputMode="numeric" min="1"
                  placeholder="数量を入力"
                  onKeyDown={(e) => { if (e.key === "Enter") { const v = parseInt((e.target as HTMLInputElement).value); if (v > 0) commitQty(v) } }}
                  style={{
                    flex: 1, height: 52, borderRadius: 10, border: `2px solid ${accentColor}`,
                    fontSize: 22, fontWeight: "bold", textAlign: "center", outline: "none",
                    color: "#1a1a1a", boxSizing: "border-box",
                  }} />
                <button
                  onClick={(e) => {
                    const input = (e.currentTarget.previousSibling as HTMLInputElement)
                    const v = parseInt(input.value)
                    if (v > 0) commitQty(v)
                  }}
                  style={{
                    height: 52, padding: "0 20px", borderRadius: 10, border: "none",
                    background: accentColor, color: "#fff", fontSize: 16, fontWeight: "bold", cursor: "pointer",
                  }}>確定</button>
              </div>

            </div>
          </div>
        )
      })()}

      {/* アクションモーダル */}
      {actionModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setActionModal(null) }}>
          <div style={{ background: C.card, borderRadius: "20px 20px 0 0", padding: "22px 20px 36px", width: "100%", maxWidth: 520, boxShadow: "0 -4px 24px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: "bold", color: C.text }}>{actionModal.item.product_name}</h2>
              <button onClick={() => setActionModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>✕</button>
            </div>
            {actionModal.item.location && (
              <p style={{ margin: "0 0 12px", fontSize: 12, color: C.sub }}>📍 {actionModal.item.location}</p>
            )}

            <p style={{ fontSize: 13, color: C.sub, marginBottom: 14 }}>
              現在在庫：<strong style={{ fontSize: 20, color: C.text }}>{actionModal.item.stock_quantity}</strong>
              {actionModal.item.units_per_package && (
                <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 4 }}>
                  {actionModal.item.stock_unit || "箱"} / {actionModal.item.stock_quantity * actionModal.item.units_per_package}{actionModal.item.unit || ""}
                </span>
              )}
              {actionModal.item.min_stock !== null && <span style={{ fontSize: 12, color: "#9ca3af" }}> （最低 {actionModal.item.min_stock}{actionModal.item.unit || ""}）</span>}
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <button onClick={() => setActionModal({ ...actionModal, type: "use" })} style={{
                flex: 1, padding: "11px 0", borderRadius: 9, fontWeight: "bold", fontSize: 15, cursor: "pointer",
                border: `2px solid ${C.blue}`,
                background: actionModal.type === "use" ? C.blue : "#fff",
                color: actionModal.type === "use" ? "#fff" : C.blue,
              }}>使用</button>
              <button onClick={() => setActionModal({ ...actionModal, type: "restock" })} style={{
                flex: 1, padding: "11px 0", borderRadius: 9, fontWeight: "bold", fontSize: 15, cursor: "pointer",
                border: `2px solid ${C.primary}`,
                background: actionModal.type === "restock" ? C.primary : "#fff",
                color: actionModal.type === "restock" ? "#fff" : C.primary,
              }}>補充</button>
            </div>

            {actionModal.type === "restock" && actionModal.item.units_per_package && (
              <div style={{ marginBottom: 12, textAlign: "center" }}>
                <button onClick={() => setActionModal({ ...actionModal, qty: actionModal.item.units_per_package! })} style={{
                  padding: "7px 18px", borderRadius: 999, border: `1.5px solid #7c3aed`,
                  background: "#f5f3ff", color: "#7c3aed", fontSize: 13, fontWeight: "bold", cursor: "pointer",
                }}>
                  1{actionModal.item.stock_unit || "箱"} = {actionModal.item.units_per_package}{actionModal.item.unit || "本"}でセット
                </button>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 20 }}>
              <button onClick={() => setActionModal({ ...actionModal, qty: Math.max(1, actionModal.qty - 1) })}
                style={{ width: 60, height: 60, borderRadius: 14, border: `1.5px solid ${C.border}`, background: "#f9fafb", fontSize: 28, cursor: "pointer", color: C.text, fontWeight: "bold" }}>−</button>
              <input type="number" min="1" value={actionModal.qty}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setActionModal({ ...actionModal, qty: v }) }}
                style={{ width: 80, height: 60, textAlign: "center", borderRadius: 12, border: `2px solid ${C.border}`, fontSize: 28, fontWeight: "bold", color: C.text, outline: "none" }} />
              <button onClick={() => setActionModal({ ...actionModal, qty: actionModal.qty + 1 })}
                style={{ width: 60, height: 60, borderRadius: 14, border: `1.5px solid ${C.border}`, background: "#f9fafb", fontSize: 28, cursor: "pointer", color: C.text, fontWeight: "bold" }}>＋</button>
            </div>

            <button onClick={confirmAction} style={{
              width: "100%", padding: 14, borderRadius: 12, border: "none",
              background: actionModal.type === "use" ? C.blue : C.primary,
              color: "#fff", fontWeight: "bold", fontSize: 16, cursor: "pointer",
            }}>
              {actionModal.type === "use" ? `使用 −${actionModal.qty} を記録` : `補充 +${actionModal.qty} を記録`}
            </button>
          </div>
        </div>
      )}

      {/* 商品追加モーダル */}
      {addModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setAddModal(false) }}>
          <div style={{ background: C.card, borderRadius: "20px 20px 0 0", padding: "22px 20px 36px", width: "100%", maxWidth: 520, boxShadow: "0 -4px 24px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: "bold", color: C.text }}>＋ 商品を追加</h2>
              <button onClick={() => setAddModal(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* 商品名（サジェスト付き） */}
              <div style={{ position: "relative" }}>
                <label style={{ fontSize: 12, color: C.sub }}>商品名<span style={{ color: "#ef4444" }}> *</span></label>
                <input
                  value={addForm.product_name}
                  placeholder="例）グローブM（マスタから検索）"
                  onChange={e => { setAddForm(f => ({ ...f, product_name: e.target.value })); searchProducts(e.target.value) }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onFocus={() => { if (productSuggestions.length > 0) setShowSuggestions(true) }}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.blue}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }}
                />
                {showSuggestions && productSuggestions.length > 0 && (
                  <div style={{
                    position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
                    background: "#fff", border: `1.5px solid ${C.blue}`, borderRadius: 9,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden",
                  }}>
                    {productSuggestions.map(p => (
                      <div key={p.id} onMouseDown={() => selectProduct(p)}
                        style={{ padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${C.border}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f0f9ff")}
                        onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                        <div style={{ fontSize: 14, fontWeight: "bold", color: C.text }}>{p.name}</div>
                        {p.manufacturer && <div style={{ fontSize: 12, color: C.sub }}>{p.manufacturer}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* その他フィールド */}
              {[
                { key: "category", label: "カテゴリ",  placeholder: "例）消耗品・麻酔薬・グローブ" },
                { key: "maker",    label: "メーカー",  placeholder: "例）ニチバン" },
                { key: "supplier", label: "注文先",    placeholder: "例）モリタ、GC" },
                { key: "barcode",  label: "バーコード", placeholder: "" },
                { key: "location", label: "置き場所",  placeholder: "例）処置室・棚A" },
                { key: "shelf_no", label: "在庫場所",  placeholder: "例）A-1" },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label style={{ fontSize: 12, color: C.sub }}>{label}</label>
                  <input value={(addForm as any)[key]} placeholder={placeholder}
                    onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }} />
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.sub }}>初期在庫数</label>
                  <input type="number" min={0} value={addForm.stock_quantity}
                    onChange={e => setAddForm(f => ({ ...f, stock_quantity: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.sub }}>最低在庫数</label>
                  <input type="number" min={0} value={addForm.min_stock} placeholder="なし"
                    onChange={e => setAddForm(f => ({ ...f, min_stock: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.sub }}>在庫数の単位（箱・袋など）</label>
                  <input value={addForm.stock_unit} placeholder="箱・袋・本"
                    onChange={e => setAddForm(f => ({ ...f, stock_unit: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.sub }}>入り数の単位（本・個・枚など）</label>
                  <input value={addForm.unit} placeholder="本・個・枚"
                    onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.sub }}>入数（1{addForm.stock_unit || "箱"}あたり）</label>
                <input type="number" min={1} value={addForm.units_per_package} placeholder="例）5"
                  onChange={e => setAddForm(f => ({ ...f, units_per_package: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 15, marginTop: 4, boxSizing: "border-box", outline: "none", color: C.text }} />
              </div>
            </div>
            <button onClick={addItem} disabled={addSaving}
              style={{ width: "100%", marginTop: 20, padding: 14, borderRadius: 12, border: "none", background: addSaving ? "#d1d5db" : C.primary, color: "#fff", fontWeight: "bold", fontSize: 16, cursor: addSaving ? "default" : "pointer" }}>
              {addSaving ? "保存中…" : "追加する"}
            </button>
          </div>
        </div>
      )}

      {/* CSVインポートモーダル */}
      {importModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setImportModal(false) }}>
          <div style={{ background: C.card, borderRadius: "20px 20px 0 0", padding: "22px 20px 36px", width: "100%", maxWidth: 520, boxShadow: "0 -4px 24px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: "bold", color: C.text }}>📥 CSVインポート</h2>
              <button onClick={() => setImportModal(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>✕</button>
            </div>

            {/* モード切替 */}
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {([
                ["insert", "📥 新規追加", "商品リストに追加する"],
                ["update", "✏️ 場所を更新", "商品名で照合して場所・棚番号を上書き"],
              ] as const).map(([mode, label, desc]) => (
                <button key={mode} onClick={() => setImportMode(mode)} style={{
                  flex: 1, padding: "9px 8px", borderRadius: 9, cursor: "pointer",
                  border: `2px solid ${importMode === mode ? C.primary : C.border}`,
                  background: importMode === mode ? "#e8f5ec" : "#f9fafb",
                  color: importMode === mode ? C.primary : C.sub,
                  fontWeight: importMode === mode ? "bold" : "normal", fontSize: 13,
                }}>
                  <div>{label}</div>
                  <div style={{ fontSize: 10, marginTop: 2, fontWeight: "normal" }}>{desc}</div>
                </button>
              ))}
            </div>

            {importMode === "update" && (
              <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 9, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#92400e" }}>
                💡 エクスポートしたCSVに「場所」「棚番号」を記入して読み込んでください。<br />
                商品名が一致する行だけ更新されます（在庫数は変わりません）。
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={downloadTemplate} style={{
                flex: 1, padding: "9px 0", borderRadius: 9, border: `1.5px solid ${C.border}`,
                background: "#f9fafb", color: C.sub, fontSize: 12, cursor: "pointer",
              }}>⬇ テンプレート</button>
              <button onClick={exportCSV} style={{
                flex: 1, padding: "9px 0", borderRadius: 9, border: `1.5px solid ${C.blue}`,
                background: "#eff6ff", color: C.blue, fontSize: 12, fontWeight: "bold", cursor: "pointer",
              }}>📤 現在の在庫をエクスポート</button>
            </div>

            <p style={{ fontSize: 13, color: C.sub, marginBottom: 10 }}>
              読み込んだデータ：<strong style={{ color: C.text }}>{importRows.length}件</strong>
            </p>

            <div style={{ overflowX: "auto", marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    {["商品名", "メーカー", "初期在庫", "場所", "棚番号"].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: C.sub, fontWeight: "bold", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importRows.slice(0, 8).map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px 8px", color: C.text, fontWeight: "bold" }}>{r["商品名"]}</td>
                      <td style={{ padding: "6px 8px", color: C.sub }}>{r["メーカー"] || "—"}</td>
                      <td style={{ padding: "6px 8px", color: C.sub }}>{r["初期在庫数"] || "0"}</td>
                      <td style={{ padding: "6px 8px", color: C.sub }}>{r["場所"] || "—"}</td>
                      <td style={{ padding: "6px 8px", color: C.sub }}>{r["棚番号"] || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importRows.length > 8 && (
                <p style={{ textAlign: "center", fontSize: 12, color: C.sub, marginTop: 6 }}>…他 {importRows.length - 8} 件</p>
              )}
            </div>

            <button onClick={importItems} disabled={importing || importRows.length === 0}
              style={{
                width: "100%", padding: 14, borderRadius: 12, border: "none",
                background: importing || importRows.length === 0 ? "#d1d5db" : C.blue,
                color: "#fff", fontWeight: "bold", fontSize: 16,
                cursor: importing || importRows.length === 0 ? "default" : "pointer",
              }}>
              {importing ? "処理中…" : importMode === "update" ? `${importRows.length}件の場所を更新する` : `${importRows.length}件をインポートする`}
            </button>
          </div>
        </div>
      )}

      {/* 写真撮影用の隠しinput */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
        style={{ display: "none" }} onChange={handlePhotoCapture} />

      {/* 一括削除フッター */}
      {bulkDeleteMode && (
        <div style={{
          position: "fixed", bottom: 56, left: 0, right: 0, zIndex: 40,
          background: "#fff", borderTop: "1.5px solid #fca5a5", padding: "10px 14px",
        }}>
          <button onClick={bulkDelete} disabled={bulkSelected.size === 0 || bulkDeleting} style={{
            width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
            background: bulkSelected.size === 0 ? "#d1d5db" : C.red,
            color: "#fff", fontWeight: "bold", fontSize: 16,
            cursor: bulkSelected.size === 0 ? "default" : "pointer",
          }}>
            {bulkDeleting ? "削除中…" : bulkSelected.size === 0 ? "商品を選択してください" : `🗑 ${bulkSelected.size}件を削除する`}
          </button>
        </div>
      )}

      {/* 下部タブバー */}
      <nav style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 600,
        background: C.card, borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 30,
      }}>
        {([
          { key: "record",  label: "記録",  icon: "✏️" },
          { key: "history", label: "履歴",  icon: "🕐" },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: "10px 0 8px", border: "none", background: "transparent", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            color: tab === t.key ? C.blue : C.sub,
            borderTop: tab === t.key ? `2px solid ${C.blue}` : "2px solid transparent",
          }}>
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            <span style={{ fontSize: 11, fontWeight: tab === t.key ? "bold" : "normal" }}>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* ── 連続スキャンカート（全画面モーダル） ── */}
      {scanCartOpen && scanCart.length > 0 && !scanning && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 600,
          background: "#f8f9fa", display: "flex", flexDirection: "column",
        }}>
          {/* ヘッダー */}
          <div style={{
            background: "#7c3aed", color: "#fff",
            padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}>
            <span style={{ fontWeight: "bold", fontSize: 17, flex: 1 }}>🛒 スキャンカート</span>
            <span style={{ background: "rgba(255,255,255,0.25)", borderRadius: 999, padding: "2px 12px", fontSize: 14, fontWeight: "bold" }}>
              {scanCart.length}品目・計{scanCart.reduce((s, e) => s + e.qty, 0)}点
            </span>
            <button onClick={() => { setScanCart([]); setScanCartOpen(false) }} style={{
              background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 8,
              padding: "5px 10px", fontSize: 12, color: "#fff", cursor: "pointer",
            }}>クリア</button>
          </div>

          {/* 品目リスト */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            {scanCart.map(({ item, qty }) => (
              <div key={item.id} style={{
                background: "#fff", borderRadius: 10, padding: "11px 14px", marginBottom: 8,
                border: `1.5px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10,
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: "bold", fontSize: 14, color: C.text, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.product_name}
                  </div>
                  {item.location && (
                    <div style={{ fontSize: 11, color: C.sub }}>📍 {item.location}</div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => setScanCart(prev => prev.map(e => e.item.id === item.id ? { ...e, qty: Math.max(1, e.qty - 1) } : e))}
                    style={{ width: 32, height: 32, borderRadius: 8, border: `1.5px solid ${C.border}`, background: "#f9fafb", cursor: "pointer", fontWeight: "bold", fontSize: 18, color: C.sub }}>−</button>
                  <span style={{ width: 36, textAlign: "center", fontWeight: "bold", fontSize: 20 }}>{qty}</span>
                  <button onClick={() => setScanCart(prev => prev.map(e => e.item.id === item.id ? { ...e, qty: e.qty + 1 } : e))}
                    style={{ width: 32, height: 32, borderRadius: 8, border: `1.5px solid ${C.border}`, background: "#f9fafb", cursor: "pointer", fontWeight: "bold", fontSize: 18, color: C.sub }}>＋</button>
                  <button onClick={() => setScanCart(prev => prev.filter(e => e.item.id !== item.id))}
                    style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "#fee2e2", cursor: "pointer", fontSize: 16, color: "#b91c1c" }}>✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* フッターボタン */}
          <div style={{ background: "#fff", borderTop: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={commitScanCart} disabled={batchProcessing}
              style={{ width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
                background: batchProcessing ? "#d1d5db" : "#7c3aed", color: "#fff",
                fontWeight: "bold", fontSize: 16, cursor: batchProcessing ? "default" : "pointer" }}>
              {batchProcessing ? "記録中…" : `✓ ${scanCart.length}品目・計${scanCart.reduce((s, e) => s + e.qty, 0)}点 まとめて使用`}
            </button>
            <button onClick={() => { setScanCartOpen(false); startBatchScan() }} style={{
              width: "100%", padding: "11px 0", borderRadius: 12, border: "none",
              background: "#ede9fe", color: "#7c3aed", fontWeight: "bold", fontSize: 14, cursor: "pointer",
            }}>🔄 スキャンを続ける</button>
          </div>
        </div>
      )}

      {/* スキャン中のカートバッジ（スキャン中のみ小さく表示） */}
      {scanning && scanCart.length > 0 && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 510,
          background: "rgba(124,58,237,0.92)", color: "#fff",
          padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontWeight: "bold", fontSize: 14 }}>
            🛒 {scanCart.length}品目・計{scanCart.reduce((s, e) => s + e.qty, 0)}点 スキャン済み
          </span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>停止後に確認・使用</span>
        </div>
      )}
    </main>
  )
}

// ── 商品カード ──
function ItemCard({ item, onQuick, onOpenModal, onOpenOptions, onEditStock, onFocusModal, editStockId, editStockValue, setEditStockValue, onConfirmEdit, onCancelEdit, onEditMin, editMinId, editMinValue, setEditMinValue, onConfirmEditMin, onCancelEditMin, onDelete, onOrder, processing, flash, setRef, bulkDeleteMode, bulkSelected, onBulkToggle, onPhotoCapture, onDeletePhoto, uploadingPhoto }: {
  item: Item
  onQuick: (item: Item, delta: number) => void
  onOpenModal: (item: Item, type: "use" | "restock") => void
  onOpenOptions: (item: Item) => void
  onOrder: (item: Item) => void
  onEditStock: (item: Item) => void
  onFocusModal: (item: Item, type: "use" | "restock") => void
  editStockId: string | null
  editStockValue: string
  setEditStockValue: (v: string) => void
  onConfirmEdit: (item: Item) => void
  onCancelEdit: () => void
  onEditMin: (item: Item) => void
  editMinId: string | null
  editMinValue: string
  setEditMinValue: (v: string) => void
  onConfirmEditMin: (item: Item) => void
  onCancelEditMin: () => void
  onDelete: (id: string, name: string) => void
  processing: boolean
  flash: boolean
  setRef: (el: HTMLDivElement | null) => void
  bulkDeleteMode: boolean
  bulkSelected: boolean
  onBulkToggle: (id: string) => void
  onPhotoCapture: (item: Item) => void
  onDeletePhoto: (item: Item) => void
  uploadingPhoto: boolean
}) {
  const effectiveStock = item.units_per_package ? item.stock_quantity * item.units_per_package : item.stock_quantity
  const needsReorder = item.min_stock !== null && effectiveStock <= item.min_stock
  const isEditing = editStockId === item.id
  const isNew = item.created_at
    ? (Date.now() - new Date(item.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000
    : false
  const isEditingMin = editMinId === item.id
  const meta = [
    item.location ? `📍 ${item.location}${item.shelf_no ? ` / ${item.shelf_no}` : ""}` : (item.shelf_no ? `棚：${item.shelf_no}` : null),
    item.maker,
    item.supplier ? `注文先：${item.supplier}` : null,
    item.barcode ? `# ${item.barcode}` : null,
  ].filter(Boolean)

  return (
    <div ref={setRef} style={{
      background: bulkSelected ? "#fff5f5" : "#fff", borderRadius: 11, padding: "10px 12px 9px", marginBottom: 7,
      border: `1.5px solid ${bulkSelected ? "#fca5a5" : needsReorder ? "#fca5a5" : "#e5e7eb"}`,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }} onClick={bulkDeleteMode ? () => onBulkToggle(item.id) : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
        {bulkDeleteMode && (
          <input type="checkbox" checked={bulkSelected} onChange={() => onBulkToggle(item.id)}
            onClick={e => e.stopPropagation()}
            style={{ width: 20, height: 20, marginRight: 10, marginTop: 2, accentColor: "#ef4444", flexShrink: 0, cursor: "pointer" }} />
        )}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
          {needsReorder && (
            <span style={{ fontSize: 10, fontWeight: "bold", background: "#fee2e2", color: "#b91c1c", padding: "1px 6px", borderRadius: 999, marginRight: 5 }}>発注必要</span>
          )}
          {isNew && (
            <span style={{ fontSize: 10, fontWeight: "bold", background: "#dbeafe", color: "#1d4ed8", padding: "1px 6px", borderRadius: 999, marginRight: 5 }}>NEW</span>
          )}
          <span style={{ fontWeight: "bold", fontSize: 14, color: "#1a1a1a" }}>{item.product_name}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {/* 在庫数インライン編集 */}
          {isEditing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input type="number" value={editStockValue} onChange={(e) => setEditStockValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") onConfirmEdit(item); if (e.key === "Escape") onCancelEdit() }}
                style={{ width: 56, height: 32, textAlign: "center", borderRadius: 8, border: "2px solid #2563eb", fontSize: 18, fontWeight: "bold", outline: "none" }} />
              <button onClick={() => onConfirmEdit(item)} style={{ background: "#22a648", color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 13, cursor: "pointer" }}>✓</button>
              <button onClick={onCancelEdit} style={{ background: "#f3f4f6", color: "#6b7280", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 13, cursor: "pointer" }}>✕</button>
            </div>
          ) : (
            <div className={flash ? "flash-anim" : ""} onClick={() => onFocusModal(item, "use")}
              style={{ cursor: "pointer", borderRadius: 6, padding: "2px 4px" }}
              title="タップで使用/補充">
              {item.units_per_package ? (
                <span style={{ lineHeight: 1 }}>
                  <span style={{ fontSize: 22, fontWeight: "bold", color: needsReorder ? "#ef4444" : "#1a1a1a" }}>{item.stock_quantity}</span>
                  <span style={{ fontSize: 13, color: "#9ca3af", fontWeight: "normal" }}> / {item.units_per_package}{item.unit || ""}</span>
                </span>
              ) : (
                <span style={{ fontSize: 22, fontWeight: "bold", color: needsReorder ? "#ef4444" : "#1a1a1a", lineHeight: 1 }}>{item.stock_quantity}</span>
              )}
            </div>
          )}

          {/* 最低在庫数インライン編集 */}
          {isEditingMin ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>/</span>
              <input type="number" value={editMinValue} onChange={(e) => setEditMinValue(e.target.value)}
                autoFocus placeholder="なし"
                onKeyDown={(e) => { if (e.key === "Enter") onConfirmEditMin(item); if (e.key === "Escape") onCancelEditMin() }}
                style={{ width: 48, height: 28, textAlign: "center", borderRadius: 7, border: "2px solid #f08c00", fontSize: 14, fontWeight: "bold", outline: "none" }} />
              <button onClick={() => onConfirmEditMin(item)} style={{ background: "#f08c00", color: "#fff", border: "none", borderRadius: 6, padding: "3px 7px", fontSize: 12, cursor: "pointer" }}>✓</button>
              <button onClick={onCancelEditMin} style={{ background: "#f3f4f6", color: "#6b7280", border: "none", borderRadius: 6, padding: "3px 7px", fontSize: 12, cursor: "pointer" }}>✕</button>
            </div>
          ) : (
            <div onClick={() => onEditMin(item)}
              style={{ cursor: "pointer", borderRadius: 6, padding: "2px 4px" }}
              title="タップで最低在庫数を編集">
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                / {item.min_stock != null
                  ? <>{item.min_stock}{item.unit || ""}</>
                  : <span style={{ color: "#d1d5db" }}>設定</span>}
              </span>
            </div>
          )}
        </div>
      </div>

      {meta.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1px 8px", marginBottom: 8 }}>
          {meta.map((v, i) => <span key={i} style={{ fontSize: 11, color: "#6b7280" }}>{v}</span>)}
        </div>
      )}

      {item.item_image_url && (
        <div style={{ marginBottom: 8, display: "inline-flex", position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.item_image_url}
            alt={item.product_name}
            style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1.5px solid #e5e7eb", display: "block" }}
          />
          <button
            onClick={e => { e.stopPropagation(); onDeletePhoto(item) }}
            disabled={uploadingPhoto}
            style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#ef4444", border: "2px solid #fff", color: "#fff", fontSize: 11, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
            title="写真を削除">✕</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <button className="inv-btn" onClick={() => onOpenModal(item, "use")}
          disabled={processing || item.stock_quantity <= 0}
          style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1.5px solid #2563eb`, background: "#fff", color: "#2563eb", fontWeight: "bold", fontSize: 13, cursor: processing || item.stock_quantity <= 0 ? "not-allowed" : "pointer", opacity: processing || item.stock_quantity <= 0 ? 0.4 : 1 }}>
          使用
        </button>
        <button className="inv-btn" onClick={() => onOpenModal(item, "restock")}
          disabled={processing}
          style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1.5px solid #22a648`, background: "#22a648", color: "#fff", fontWeight: "bold", fontSize: 13, cursor: processing ? "not-allowed" : "pointer", opacity: processing ? 0.4 : 1 }}>
          補充
        </button>
        {item.product_id && (
          <button className="inv-btn" onClick={() => onOrder(item)}
            disabled={processing}
            style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1.5px solid #f08c00`, background: needsReorder ? "#fff7ed" : "#fff", color: "#f08c00", fontWeight: "bold", fontSize: 13, cursor: processing ? "not-allowed" : "pointer", opacity: processing ? 0.4 : 1 }}>
            📦 発注
          </button>
        )}
        <button className="inv-btn" onClick={() => onPhotoCapture(item)}
          disabled={processing || uploadingPhoto}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1.5px solid #e5e7eb`, background: item.item_image_url ? "#f0fdf4" : "#fff", color: item.item_image_url ? "#22a648" : "#6b7280", fontSize: 13, cursor: processing || uploadingPhoto ? "not-allowed" : "pointer", opacity: processing || uploadingPhoto ? 0.4 : 1 }}
          title={item.item_image_url ? "写真を撮り直す" : "写真を撮る"}>
          {uploadingPhoto ? "…" : "📷"}
        </button>
        <button className="inv-btn" onClick={() => onOpenOptions(item)}
          disabled={processing}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1.5px solid #e5e7eb`, background: "#fff", color: "#6b7280", fontSize: 13, cursor: processing ? "not-allowed" : "pointer", opacity: processing ? 0.4 : 1 }}>
          ···
        </button>
        <button className="inv-btn" onClick={() => onDelete(item.id, item.product_name)}
          disabled={processing}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1.5px solid #fee2e2`, background: "#fff", color: "#ef4444", fontSize: 13, cursor: processing ? "not-allowed" : "pointer", opacity: processing ? 0.4 : 1 }}
          title="削除">
          🗑
        </button>
      </div>
    </div>
  )
}
