// src/pages/PurchasePage.jsx
import { useState, useRef } from 'react'
import { C, S } from '../App'

export default function PurchasePage({ products, suppliers, purchaseOrders,
                                       totalStock, findProduct, createPO, shout }) {
  const [view, setView] = useState('list') // list | new | detail
  const [currentPO, setCurrentPO] = useState(null)
  const [items, setItems] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [note, setNote] = useState('')
  const [scanQ, setScanQ] = useState('')
  const [scanQty, setScanQty] = useState(1)
  const [scanCost, setScanCost] = useState('')
  const [scanExpiry, setScanExpiry] = useState('')
  const ref = useRef()

  const lowStock = products.filter(p => totalStock(p.id) < p.min_stock)

  const addItem = () => {
    const q = scanQ.trim(); if (!q) return
    const p = findProduct(q)
    if (!p) { shout(`找不到：${q}`, true); return }
    const qty = parseInt(scanQty) || 1
    const cost = parseFloat(scanCost) || p.cost
    const existing = items.findIndex(i => i.product_id === p.id)
    if (existing >= 0) {
      setItems(prev => prev.map((it, i) => i === existing ? { ...it, qty: it.qty + qty } : it))
    } else {
      setItems(prev => [...prev, { product_id: p.id, qty, cost, expiry_date: scanExpiry || null, product: p }])
    }
    setScanQ(''); setScanQty(1); setScanCost(''); setScanExpiry('')
    shout(`已加入：${p.name} ${p.variant_name || ''} × ${qty}`)
    setTimeout(() => ref.current?.focus(), 100)
  }

  const confirmPO = async () => {
    if (items.length === 0) { shout('请先加入产品', true); return }
    const po = {
      id: crypto.randomUUID(),
      po_number: `PO-${Date.now().toString().slice(-6)}`,
      supplier_id: supplierId || null,
      order_date: date,
      status: 'received',
      note,
    }
    try {
      await createPO(po, items.map(i => ({ id: crypto.randomUUID(), product_id: i.product_id, qty: i.qty, cost: i.cost, expiry_date: i.expiry_date })))
      setItems([]); setSupplierId(''); setNote(''); setView('list')
      shout(`入货单 ${po.po_number} 已确认，${items.length} 种产品已入库 ✓`)
    } catch (e) { shout('保存失败，请重试', true) }
  }

  if (view === 'detail' && currentPO) {
    const sup = suppliers.find(s => s.id === currentPO.supplier_id)
    const poItemsList = currentPO.po_items || []
    const total = poItemsList.reduce((s, i) => s + i.qty * (i.cost || 0), 0)
    return (
      <div>
        <button onClick={() => { setView('list'); setCurrentPO(null) }} style={{ background:'none', border:'none', color:C.orange, fontWeight:700, fontSize:14, cursor:'pointer', paddingBottom:12 }}>← 返回</button>
        <div style={S.card}>
          <div style={S.secTitle}>{currentPO.po_number}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
            {[['供应商', sup?.name || '未指定'], ['日期', currentPO.order_date], ['状态', '已收货'], ['总金额', `RM ${total.toFixed(2)}`]].map(([l, v]) => (
              <div key={l} style={{ background:C.cream, borderRadius:8, padding:'8px 10px' }}>
                <div style={{ fontSize:10, color:C.slate }}>{l}</div>
                <div style={{ fontSize:13, fontWeight:700 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={S.secTitle}>产品明细</div>
          {poItemsList.map((item, i) => {
            const p = products.find(x => x.id === item.product_id)
            return (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, paddingBottom:10, marginBottom:10, borderBottom: i < poItemsList.length - 1 ? `1px solid ${C.cream}` : 'none' }}>
                {p?.photo_url && <img src={p.photo_url} style={{ width:36, height:36, borderRadius:7, objectFit:'cover' }} alt="" />}
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{p?.name} <span style={{ color:C.orange }}>{p?.variant_name}</span></div>
                  <div style={{ fontSize:11, color:C.slate }}>RM {(item.cost||0).toFixed(2)}/件{item.expiry_date ? ` · 效期 ${item.expiry_date}` : ''}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:16, fontWeight:900 }}>{item.qty}</div>
                  <div style={{ fontSize:10, color:C.slate }}>件</div>
                </div>
              </div>
            )
          })}
          {currentPO.note && <div style={{ fontSize:11, color:C.slate, marginTop:8 }}>备注：{currentPO.note}</div>}
        </div>
      </div>
    )
  }

  if (view === 'new') return (
    <div>
      <button onClick={() => setView('list')} style={{ background:'none', border:'none', color:C.orange, fontWeight:700, fontSize:14, cursor:'pointer', paddingBottom:12 }}>← 返回</button>

      <div style={S.card}>
        <div style={S.secTitle}>📋 新建入货单</div>
        <div style={{ marginBottom:10 }}>
          <label style={S.lbl}>供应商</label>
          <select style={S.inp} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">— 选择供应商（选填）—</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div><label style={S.lbl}>入货日期</label><input type="date" style={S.inp} value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><label style={S.lbl}>备注</label><input style={S.inp} placeholder="可选" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.secTitle}>扫码加入产品</div>
        <div style={{ display:'flex', gap:8, marginBottom:10 }}>
          <input ref={ref} style={{ ...S.inp, flex:1 }} placeholder="条码 / SKU / 产品名… Enter"
            value={scanQ} onChange={e => setScanQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()} autoFocus />
          <button onClick={addItem} style={{ ...S.btn(C.orange, false), padding:'11px 14px' }}>加入</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:10 }}>
          <div><label style={S.lbl}>数量</label><input type="number" min={1} style={S.inp} value={scanQty} onChange={e => setScanQty(e.target.value)} /></div>
          <div><label style={S.lbl}>成本 RM/件</label><input type="number" style={S.inp} placeholder="默认" value={scanCost} onChange={e => setScanCost(e.target.value)} /></div>
          <div><label style={S.lbl}>有效日期</label><input type="date" style={S.inp} value={scanExpiry} onChange={e => setScanExpiry(e.target.value)} /></div>
        </div>
        {lowStock.length > 0 && (
          <div>
            <div style={{ fontSize:11, color:C.slate, marginBottom:6 }}>⚠ 需补货快速选择：</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {lowStock.slice(0, 6).map(p => (
                <button key={p.id} onClick={() => { setScanQ(p.sku); setScanCost(String(p.cost)) }}
                  style={{ background:C.cream, border:`1px solid ${C.orange}40`, borderRadius:6, padding:'4px 8px', fontSize:11, cursor:'pointer', color:C.navy }}>
                  {p.variant_name || p.name} <span style={{ color:C.red, fontWeight:700 }}>({totalStock(p.id)}件)</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div style={S.card}>
          <div style={S.secTitle}>已加入 {items.length} 种产品</div>
          {items.map((item, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10, paddingBottom:10, marginBottom:10, borderBottom: i < items.length - 1 ? `1px solid ${C.cream}` : 'none' }}>
              {item.product.photo_url && <img src={item.product.photo_url} style={{ width:36, height:36, borderRadius:7, objectFit:'cover' }} alt="" />}
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{item.product.name} <span style={{ color:C.orange }}>{item.product.variant_name}</span></div>
                <div style={{ fontSize:11, color:C.slate }}>RM {item.cost.toFixed(2)}/件{item.expiry_date ? ` · 效期 ${item.expiry_date}` : ''}</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ textAlign:'right' }}><div style={{ fontSize:16, fontWeight:900 }}>{item.qty}</div><div style={{ fontSize:10, color:C.slate }}>件</div></div>
                <button onClick={() => setItems(prev => prev.filter((_, j) => j !== i))}
                  style={{ background:'none', border:`1px solid ${C.red}`, borderRadius:5, padding:'3px 7px', fontSize:10, cursor:'pointer', color:C.red }}>删</button>
              </div>
            </div>
          ))}
          <div style={{ borderTop:`2px solid ${C.cream}`, paddingTop:10, display:'flex', justifyContent:'space-between', marginBottom:12 }}>
            <span style={{ fontSize:13, fontWeight:700 }}>总入货成本</span>
            <span style={{ fontSize:16, fontWeight:900 }}>RM {items.reduce((s, i) => s + i.qty * i.cost, 0).toFixed(2)}</span>
          </div>
          <button onClick={confirmPO} style={S.btn(C.green)}>✓ 确认入货，批量入库</button>
        </div>
      )}
    </div>
  )

  // List view
  return (
    <div>
      <button onClick={() => { setView('new'); setItems([]); setSupplierId(''); setNote('') }}
        style={{ ...S.btn(), marginBottom:12 }}>+ 新建入货单</button>
      {purchaseOrders.length === 0 && (
        <div style={{ ...S.card, textAlign:'center', padding:'32px', color:C.slate }}>
          <div style={{ fontSize:32, marginBottom:8 }}>📋</div>
          <div>暂无入货记录</div>
        </div>
      )}
      {purchaseOrders.map(po => {
        const sup = suppliers.find(s => s.id === po.supplier_id)
        const poItems = po.po_items || []
        const total = poItems.reduce((s, i) => s + i.qty * (i.cost || 0), 0)
        const totalQty = poItems.reduce((s, i) => s + i.qty, 0)
        return (
          <div key={po.id} style={{ ...S.card, cursor:'pointer' }} onClick={() => { setCurrentPO(po); setView('detail') }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700 }}>{po.po_number}</div>
                <div style={{ fontSize:11, color:C.slate }}>{sup?.name || '未指定供应商'} · {po.order_date}</div>
              </div>
              <span style={{ ...S.tag(C.green) }}>已收货</span>
            </div>
            <div style={{ fontSize:12, color:C.slate }}>{poItems.length} 种产品 · {totalQty} 件 · <strong>RM {total.toFixed(2)}</strong></div>
            {po.note && <div style={{ fontSize:11, color:C.slateLight, marginTop:4 }}>备注：{po.note}</div>}
          </div>
        )
      })}
    </div>
  )
}
