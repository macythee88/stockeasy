// src/hooks/useData.js
// Central data hook — fetches from Supabase, caches locally,
// exposes mutations that work offline via the queue.

import { useState, useEffect, useCallback } from 'react'
import { supabase, safeUpsert, safeDelete, flushQueue } from '../lib/supabase'

export function useData() {
  const [products,       setProducts]       = useState([])
  const [batches,        setBatches]        = useState([])
  const [suppliers,      setSuppliers]      = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [loading,        setLoading]        = useState(true)
  const [online,         setOnline]         = useState(navigator.onLine)

  // ── Online/offline detection ───────────────────────────────
  useEffect(() => {
    const go  = () => { setOnline(true);  flushQueue() }
    const off = () => setOnline(false)
    window.addEventListener('online',  go)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', go); window.removeEventListener('offline', off) }
  }, [])

  // ── Initial fetch ──────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [p, b, s, po] = await Promise.all([
        supabase.from('products').select('*').order('name'),
        supabase.from('batches').select('*').order('expiry_date'),
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('purchase_orders').select('*, po_items(*)').order('created_at', { ascending: false }),
      ])
      if (p.data)  setProducts(p.data)
      if (b.data)  setBatches(b.data)
      if (s.data)  setSuppliers(s.data)
      if (po.data) setPurchaseOrders(po.data)
    } catch (e) {
      console.error('Fetch failed (possibly offline)', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Real-time subscriptions ────────────────────────────────
  useEffect(() => {
    const channel = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'batches' },  fetchAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchAll])

  // ── Products ───────────────────────────────────────────────
  const upsertProduct = async (product) => {
    const data = { ...product }
    await safeUpsert('products', data)
    setProducts(prev => {
      const idx = prev.findIndex(p => p.id === data.id)
      return idx >= 0 ? prev.map(p => p.id === data.id ? data : p) : [...prev, data]
    })
  }

  // ── Batches ────────────────────────────────────────────────
  const addBatch = async (batch) => {
    await safeUpsert('batches', batch)
    setBatches(prev => [...prev, batch])
  }

  const updateBatch = async (batch) => {
    await safeUpsert('batches', batch)
    setBatches(prev => prev.map(b => b.id === batch.id ? batch : b))
  }

  const deleteBatch = async (id) => {
    await safeDelete('batches', id)
    setBatches(prev => prev.filter(b => b.id !== id))
  }

  // FEFO stock-out
  const stockOut = async (productId, qty) => {
    const pBatches = [...batches]
      .filter(b => b.product_id === productId && b.qty > 0)
      .sort((a, b) => {
        if (!a.expiry_date && !b.expiry_date) return 0
        if (!a.expiry_date) return 1
        if (!b.expiry_date) return -1
        return a.expiry_date.localeCompare(b.expiry_date)
      })
    let remaining = qty
    const updated = []
    for (const b of pBatches) {
      if (remaining <= 0) break
      const deduct = Math.min(b.qty, remaining)
      const newBatch = { ...b, qty: b.qty - deduct }
      remaining -= deduct
      updated.push(newBatch)
    }
    for (const b of updated) {
      if (b.qty <= 0) {
        await safeDelete('batches', b.id)
      } else {
        await safeUpsert('batches', b)
      }
    }
    setBatches(prev => prev
      .map(b => { const u = updated.find(x => x.id === b.id); return u ? u : b })
      .filter(b => b.qty > 0)
    )
  }

  // ── Purchase Orders ────────────────────────────────────────
  const createPO = async (po, items) => {
    // Insert PO
    await safeUpsert('purchase_orders', po)
    // Insert items
    for (const item of items) {
      await safeUpsert('po_items', { ...item, po_id: po.id })
      // Create batch for each item
      const batch = {
        id:            crypto.randomUUID(),
        product_id:    item.product_id,
        batch_no:      `LOT-${po.order_date.replace(/-/g,'')}-${Math.floor(Math.random()*999).toString().padStart(3,'0')}`,
        qty:           item.qty,
        received_date: po.order_date,
        expiry_date:   item.expiry_date || null,
        cost:          item.cost,
        po_id:         po.id,
      }
      await safeUpsert('batches', batch)
      setBatches(prev => [...prev, batch])
    }
    setPurchaseOrders(prev => [{ ...po, po_items: items }, ...prev])
  }

  // ── Suppliers ──────────────────────────────────────────────
  const upsertSupplier = async (supplier) => {
    await safeUpsert('suppliers', supplier)
    setSuppliers(prev => {
      const idx = prev.findIndex(s => s.id === supplier.id)
      return idx >= 0 ? prev.map(s => s.id === supplier.id ? supplier : s) : [...prev, supplier]
    })
  }

  // ── Computed helpers ───────────────────────────────────────
  const totalStock = (productId) =>
    batches.filter(b => b.product_id === productId).reduce((s, b) => s + b.qty, 0)

  const productBatches = (productId) =>
    batches
      .filter(b => b.product_id === productId && b.qty > 0)
      .sort((a, b) => {
        if (!a.expiry_date && !b.expiry_date) return 0
        if (!a.expiry_date) return 1
        if (!b.expiry_date) return -1
        return a.expiry_date.localeCompare(b.expiry_date)
      })

  const findProduct = (query) => {
    const q = query.toLowerCase()
    return products.find(p =>
      p.barcode === query || p.sku === query ||
      p.name.toLowerCase().includes(q) ||
      (p.variant_name || '').toLowerCase().includes(q)
    )
  }

  return {
    // State
    products, batches, suppliers, purchaseOrders, loading, online,
    // Mutations
    upsertProduct, addBatch, updateBatch, deleteBatch, stockOut, createPO, upsertSupplier,
    // Helpers
    totalStock, productBatches, findProduct,
    // Refresh
    refetch: fetchAll,
  }
}
