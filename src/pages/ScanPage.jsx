// src/pages/ScanPage.jsx
import { useState, useRef } from 'react'
import { C, S, StatusBadge } from '../App'
import { uploadPhoto } from '../lib/supabase'

const daysUntil = d => d ? Math.ceil((new Date(d) - new Date()) / 864e5) : null
const expiryColor = d => {
  if (d === null) return C.slate
  if (d <= 0)  return C.red
  if (d <= 14) return C.red
  if (d <= 30) return C.yellow
  return C.green
}

export default function ScanPage({ products, batches, suppliers, shout,
                                   totalStock, productBatches, findProduct,
                                   addBatch, updateBatch, deleteBatch, stockOut,
                                   upsertProduct }) {
  const [query,      setQuery]      = useState('')
  const [scanView,   setScanView]   = useState(null)
  const [action,     setAction]     = useState(null) // 'in' | 'out'
  const [editBatch,  setEditBatch]  = useState(null)
  const [outQty,     setOutQty]     = useState(1)
  const [batchForm,  setBatchForm]  = useState({})
  const inputRef = useRef()

  const todayStr = new Date().toISOString().split('T')[0]

  const genBatchNo = () => {
    const d = new Date()
    return `LOT-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*999).toString().padStart(3,'0')}`
  }

  const doLookup = (q = query) => {
    if (!q.trim()) return
    const p = findProduct(q.trim())
    if (!p) { setScanView({ error: `找不到：${q}` }); return }
    setScanView({ product: p })
    setAction(null); setEditBatch(null)
    setBatchForm({ batch_no: genBatchNo(), qty: '', received_date: todayStr, expiry_date: '', cost: String(p.cost) })
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const handleStockIn = async () => {
    const qty = parseInt(batchForm.qty) || 0
    if (qty <= 0) { shout('请输入有效数量', true); return }
    const p = scanView.product
    try {
      if (editBatch) {
        await updateBatch({ ...editBatch, qty, batch_no: batchForm.batch_no,
          received_date: batchForm.received_date, expiry_date: batchForm.expiry_date || null,
          cost: parseFloat(batchForm.cost) || p.cost })
        shout('批次已更新 ✓')
      } else {
        await addBatch({ id: crypto.randomUUID(), product_id: p.id,
          batch_no: batchForm.batch_no || genBatchNo(), qty,
          received_date: batchForm.received_date || todayStr,
          expiry_date: batchForm.expiry_date || null,
          cost: parseFloat(batchForm.cost) || p.cost })
        shout(`${p.name} 入库 ${qty} 件 ✓`)
      }
      setAction(null); setEditBatch(null)
    } catch (e) { shout('操作失败，请重试', true) }
  }

  const handleStockOut = async () => {
    const qty = parseInt(outQty) || 0
    if (qty <= 0) { shout('请输入数量', true); return }
    const total = totalStock(scanView.product.id)
    if (qty > total) { shout(`库存不足，现有 ${total} 件`, true); return }
    try {
      await stockOut(scanView.product.id, qty)
      shout(`出库 ${qty} 件（FEFO）✓`)
      setAction(null)
    } catch (e) { shout('出库失败', true) }
  }

  const p    = scanView?.product
  const pBat = p ? productBatches(p.id) : []
  const stock = p ? totalStock(p.id) : 0

  return (
    <div>
      {/* Search bar */}
      <div style={S.card}>
        <div style={S.secTitle}>🔍 扫码查询</div>
        <div style={{ display:'flex', gap:8 }}>
          <input ref={inputRef} style={{ ...S.inp, flex:1 }}
            placeholder="条码 / SKU / 产品名… (Enter)" value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doLookup()} autoFocus />
          <button onClick={() => doLookup()} style={{ ...S.btn(C.orange, false), padding:'11px 14px' }}>查询</button>
        </div>
        <div style={{ fontSize:11, color:C.slateLight, marginTop:6 }}>支持条码 · SKU · 产品名 · 扫码枪</div>
      </div>

      {/* Quick pick */}
      <div style={{ ...S.card, background: C.navyLight }}>
        <div style={{ fontSize:11, color:C.slateLight, marginBottom:8, fontWeight:700 }}>📋 快速选择</div>
        {products.slice(0, 6).map(prod => (
          <div key={prod.id} onClick={() => { setQuery(prod.barcode || prod.sku); doLookup(prod.barcode || prod.sku) }}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0',
                     borderBottom:`1px solid #ffffff10`, cursor:'pointer' }}>
            {prod.photo_url && <img src={prod.photo_url} style={{ width:26, height:26, borderRadius:5, objectFit:'cover' }} alt="" />}
            <div style={{ flex:1, fontSize:12, color:'#F7F5F0' }}>{prod.name} <span style={{ color:C.slateLight }}>{prod.variant_name}</span></div>
            <div style={{ fontSize:12, color:C.orange, fontWeight:700 }}>{totalStock(prod.id)}件</div>
          </div>
        ))}
      </div>

      {/* Error */}
      {scanView?.error && (
        <div style={{ ...S.card, border:`2px solid ${C.red}` }}>
          <div style={{ color:C.red, fontWeight:700 }}>{scanView.error}</div>
        </div>
      )}

      {/* Product view */}
      {p && (
        <div>
          <div style={{ ...S.card, border:`2px solid ${C.orange}33` }}>
            <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:12 }}>
              {p.photo_url
                ? <img src={p.photo_url} style={{ width:72, height:72, borderRadius:12, objectFit:'cover', flexShrink:0 }} alt="" />
                : <div style={{ width:72, height:72, borderRadius:12, background:C.cream, display:'flex', alignItems:'center', justifyContent:'center', fontSize:28 }}>📦</div>}
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:800, fontSize:16 }}>{p.name}</div>
                <div style={{ fontSize:13, color:C.orange, fontWeight:600 }}>{p.variant_name}</div>
                <div style={{ fontSize:10, color:C.slateLight, fontFamily:'monospace' }}>{p.sku}</div>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:12 }}>
              {[['总库存',`${stock}件`,C.navy],['成本',`RM${p.cost?.toFixed(2)}`,C.navy],['批次',`${pBat.length}批`,C.slate]].map(([l,v,col]) => (
                <div key={l} style={{ textAlign:'center', background:C.cream, borderRadius:8, padding:'7px 4px' }}>
                  <div style={{ fontSize:14, fontWeight:800, color:col }}>{v}</div>
                  <div style={{ fontSize:10, color:C.slate }}>{l}</div>
                </div>
              ))}
            </div>
            {!action && (
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => { setAction('in'); setEditBatch(null); setBatchForm({ batch_no: genBatchNo(), qty:'', received_date: todayStr, expiry_date:'', cost: String(p.cost) }) }}
                  style={S.btn(C.green, true, true)}>📦 入库</button>
                <button onClick={() => { setAction('out'); setOutQty(1) }}
                  style={S.btn(C.red, true, true)}>📤 出库</button>
              </div>
            )}
          </div>

          {/* Batch list */}
          <div style={S.card}>
            <div style={S.secTitle}>批次明细（FEFO 顺序）</div>
            {pBat.length === 0 && <div style={{ fontSize:13, color:C.slateLight, textAlign:'center', padding:'12px' }}>暂无批次</div>}
            {pBat.map((b, i) => {
              const days = b.expiry_date ? daysUntil(b.expiry_date) : null
              const col  = expiryColor(days)
              return (
                <div key={b.id} style={{ padding:'10px', borderRadius:10, marginBottom:8,
                    background: days !== null && days <= 30 ? col+'12' : C.cream }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <div>
                      <span style={{ fontSize:12, fontWeight:700 }}>{b.batch_no}</span>
                      {i === 0 && pBat.some(x => x.expiry_date) && <span style={{ ...S.tag(C.orange), marginLeft:6 }}>先出</span>}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontSize:16, fontWeight:900 }}>{b.qty}<span style={{ fontSize:10, fontWeight:400, color:C.slate }}> 件</span></span>
                      <button onClick={() => { setEditBatch(b); setBatchForm({ batch_no:b.batch_no, qty:String(b.qty), received_date:b.received_date, expiry_date:b.expiry_date||'', cost:String(b.cost||p.cost) }); setAction('in') }}
                        style={{ background:'none', border:`1px solid ${C.slate}`, borderRadius:5, padding:'3px 7px', fontSize:10, cursor:'pointer', color:C.slate }}>编辑</button>
                      <button onClick={async () => { if (!confirm('删除此批次？')) return; await deleteBatch(b.id); shout('已删除') }}
                        style={{ background:'none', border:`1px solid ${C.red}`, borderRadius:5, padding:'3px 7px', fontSize:10, cursor:'pointer', color:C.red }}>删</button>
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:C.slate }}>入库：{b.received_date} · RM {(b.cost||0).toFixed(2)}/件</div>
                  {b.expiry_date && (
                    <div style={{ fontSize:11, color:col, fontWeight:700, marginTop:3 }}>
                      {days <= 0 ? '⛔ 已过期' : days <= 14 ? `🔴 ${days}天到期` : days <= 30 ? `🟡 ${days}天到期` : `✅ ${days}天到期`}
                      {' · '}{b.expiry_date}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Stock IN form */}
          {action === 'in' && (
            <div style={{ ...S.card, border:`2px solid ${C.green}40` }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:12, color:C.green }}>
                {editBatch ? '✏ 编辑批次' : '📦 新增入库'}
              </div>
              {[['批次号','batch_no','text'],['入库数量','qty','number'],['入库日期','received_date','date'],
                ...(p.has_expiry ? [['有效日期','expiry_date','date']] : []),
                ['成本 RM/件','cost','number']].map(([l,k,t]) => (
                <div key={k} style={{ marginBottom:10 }}>
                  <label style={S.lbl}>{l}</label>
                  <input type={t} style={S.inp} value={batchForm[k] || ''} onChange={e => setBatchForm(f => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
              {p.has_expiry && <div style={{ fontSize:11, color:C.purple, marginBottom:10, padding:'7px 10px', background:C.purple+'12', borderRadius:8 }}>⚠ 此产品启用效期管理，请填写有效日期</div>}
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={handleStockIn} style={S.btn(C.green)}>✓ {editBatch ? '保存' : '确认入库'}</button>
                <button onClick={() => { setAction(null); setEditBatch(null) }} style={S.btn(C.slate, false)}>取消</button>
              </div>
            </div>
          )}

          {/* Stock OUT */}
          {action === 'out' && (
            <div style={{ ...S.card, border:`2px solid ${C.red}40` }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:4, color:C.red }}>📤 出库 — FEFO 自动先出最早到期</div>
              <div style={{ marginBottom:12 }}>
                <label style={S.lbl}>出库数量（现有 {stock} 件）</label>
                <input type="number" min={1} max={stock} style={S.inp} value={outQty} onChange={e => setOutQty(parseInt(e.target.value)||1)} />
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={handleStockOut} style={S.btn(C.red)}>✓ 确认出库</button>
                <button onClick={() => setAction(null)} style={S.btn(C.slate, false)}>取消</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
