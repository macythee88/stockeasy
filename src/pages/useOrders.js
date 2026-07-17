// src/hooks/useOrders.js
// Orders data hook — fetch, realtime sync, mutations

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useOrders() {
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)
  const [online,  setOnline]  = useState(navigator.onLine)

  useEffect(() => {
    const go  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online',  go)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online',go); window.removeEventListener('offline',off) }
  }, [])

  // ── Fetch all orders with items ───────────────────────────
  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`*, order_items(*, products(name, variant_name, photo_url, sku))`)
        .order('created_at', { ascending: false })
      if (!error && data) setOrders(data)
    } catch(e) { console.error('fetchOrders:', e) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // ── Realtime subscription ─────────────────────────────────
  useEffect(() => {
    const channel = supabase.channel('orders-changes')
      .on('postgres_changes', { event:'*', schema:'public', table:'orders' }, fetchOrders)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchOrders])

  // ── Mark order as processed ───────────────────────────────
  const markProcessed = async (orderId) => {
    const { error } = await supabase
      .from('orders')
      .update({ status:'processed' })
      .eq('id', orderId)
    if (!error) setOrders(prev => prev.map(o => o.id===orderId ? {...o,status:'processed'} : o))
    return !error
  }

  // ── Mark as return ────────────────────────────────────────
  const markReturn = async (orderId, reason='') => {
    const { error } = await supabase
      .from('orders')
      .update({ status:'return', return_reason:reason })
      .eq('id', orderId)
    if (!error) setOrders(prev => prev.map(o => o.id===orderId ? {...o,status:'return',return_reason:reason} : o))
    return !error
  }

  // ── Restore stock from return (FEFO add-back) ─────────────
  const restoreStock = async (orderId) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return false

    // For each item in return, add stock back as a new batch
    const today = new Date().toISOString().split('T')[0]
    for (const item of (order.order_items || [])) {
      if (!item.product_id || !item.qty) continue
      // 用产品的真实进货成本，而不是订单的售价（item.unit_price 是客人付的钱，不是成本）
      const { data: prod, error: costErr } = await supabase
        .from('products').select('cost').eq('id', item.product_id).single()
      if (costErr) console.error('restoreStock 读取产品成本失败:', costErr)
      const { error } = await supabase.from('batches').insert({
        id:            crypto.randomUUID(),
        product_id:    item.product_id,
        batch_no:      `RETURN-${orderId}`,
        qty:           item.qty,
        received_date: today,
        expiry_date:   null,
        cost:          prod?.cost ?? 0,
      })
      if (error) { console.error('restoreStock batch insert:', error); return false }
    }

    // Mark order stock restored
    await supabase.from('orders').update({ stock_restored:true }).eq('id', orderId)
    setOrders(prev => prev.map(o => o.id===orderId ? {...o,stock_restored:true} : o))
    return true
  }

  // 注：Excel 订单导入的实际逻辑现在直接写在 OrdersPage.jsx 里
  // （parseOrderXlsx + writeOrdersToSupabase，处理 order_items、SKU/商品名匹配、状态映射等），
  // 这里原本有一个更早期、不完整的 importOrders 占位函数（没处理 order_items，状态写死 unprocessed），
  // 已经没有地方在调用，为了避免以后误用就整个移除了。

  // ── Counts ────────────────────────────────────────────────
  const counts = {
    unprocessed: orders.filter(o=>o.status==='unprocessed').length,
    processed:   orders.filter(o=>o.status==='processed').length,
    return:      orders.filter(o=>o.status==='return').length,
  }

  return {
    orders, loading, online, counts,
    fetchOrders, markProcessed, markReturn, restoreStock,
  }
}
