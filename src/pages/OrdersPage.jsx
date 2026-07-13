// src/pages/OrdersPage.jsx
// Full order management: pick list + dispatch + returns + print

import { useState, useMemo, useRef } from 'react'
import { C, S } from '../App'
import * as XLSX from 'xlsx'

const PLATFORMS = {
  'Shopee SG': { color:'#EE4D2D', bg:'#FFF0EE', icon:'🛍️' },
  'Shopee MY': { color:'#EE4D2D', bg:'#FFF0EE', icon:'🛍️' },
  'Lazada SG': { color:'#0F146D', bg:'#EEEFFE', icon:'🟠' },
  'Lazada MY': { color:'#0F146D', bg:'#EEEFFE', icon:'🟠' },
  'TikTok':    { color:'#010101', bg:'#F0F0F0', icon:'🎵' },
}

// ── Pick list builder ─────────────────────────────────────────
function buildPickList(orders) {
  const map = {}
  orders.filter(o => o.status === 'unprocessed').forEach(order => {
    const items = order.order_items || []
    items.forEach(item => {
      const key = `${item.sku}::${item.variant_name||''}`
      if (!map[key]) map[key] = {
        sku: item.sku,
        name: item.name || item.products?.name || '',
        variant: item.variant_name || item.products?.variant_name || '',
        location: item.location || '',
        photo: item.products?.photo_url || '',
        totalQty: 0, orders: []
      }
      map[key].totalQty += item.qty
      map[key].orders.push({ orderId:order.id, platform:order.platform, qty:item.qty })
    })
  })
  return Object.values(map).sort((a,b) => b.totalQty - a.totalQty)
}

// ── Print ─────────────────────────────────────────────────────
function printSlip(order) {
  const plat = PLATFORMS[order.platform] || {}
  const items = order.order_items || []
  const w = window.open('','_blank','width=420,height=650')
  w.document.write(`<!DOCTYPE html><html><head><title>#${order.id}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Helvetica Neue',sans-serif;padding:20px;color:#111;max-width:400px}
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #eee}
    .badge{padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;background:${plat.bg||'#eee'};color:${plat.color||'#333'}}
    .order-id{font-size:20px;font-weight:900}
    .meta{font-size:11px;color:#777;margin-bottom:12px;line-height:1.8}
    table{width:100%;border-collapse:collapse;margin-bottom:12px}
    th{background:#f5f5f5;font-size:11px;padding:6px 8px;text-align:left;font-weight:700;border:1px solid #ddd}
    td{padding:8px;border:1px solid #ddd;font-size:12px;vertical-align:middle}
    .qty{font-size:24px;font-weight:900;text-align:center}
    .loc{background:#0F1B2D;color:#FF6B35;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;display:inline-block}
    .total{text-align:right;font-size:16px;font-weight:900;padding:8px 0;border-top:2px solid #eee}
    .footer{font-size:9px;color:#aaa;text-align:center;margin-top:12px;padding-top:8px;border-top:1px dashed #ddd}
    @media print{body{padding:10px}}
  </style></head><body>
  <div class="header">
    <div class="order-id">#${order.id}</div>
    <span class="badge">${plat.icon||''} ${order.platform}</span>
  </div>
  <div class="meta">
    客户：${order.customer||'—'}<br>
    时间：${new Date(order.created_at||Date.now()).toLocaleString()}<br>
    ${order.return_reason?'退货原因：'+order.return_reason:''}
  </div>
  <table>
    <tr><th>商品</th><th>变体</th><th>数量</th><th>库位</th></tr>
    ${items.map(it=>`
    <tr>
      <td>${it.name||it.products?.name||'—'}</td>
      <td>${it.variant_name||it.products?.variant_name||'—'}</td>
      <td class="qty">${it.qty}</td>
      <td><span class="loc">${it.location||'—'}</span></td>
    </tr>`).join('')}
  </table>
  <div class="total">合计：${order.total?.toFixed?.(2)||'—'}</div>
  <div class="footer">StockEasy · upin-global.com · ${new Date().toLocaleString()}</div>
  <script>window.onload=()=>window.print()</script>
  </body></html>`)
  w.document.close()
}

function printPickList(pickList) {
  const w = window.open('','_blank','width=800,height=900')
  w.document.write(`<!DOCTYPE html><html><head><title>今日拣货清单</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Helvetica Neue',sans-serif;padding:20px;color:#111}
    h1{font-size:20px;margin-bottom:4px}
    .sub{font-size:12px;color:#777;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th{background:#0F1B2D;color:#FF6B35;font-size:12px;padding:8px 10px;text-align:left}
    td{padding:10px;border-bottom:1px solid #eee;font-size:13px;vertical-align:middle}
    tr:nth-child(even) td{background:#FAFAF8}
    .num{width:32px;height:32px;border-radius:50%;background:#FF6B35;color:#fff;
         display:inline-flex;align-items:center;justify-content:center;font-weight:900;font-size:14px}
    .qty{font-size:28px;font-weight:900;text-align:center}
    .loc{background:#0F1B2D;color:#FF6B35;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:700}
    .plat{display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;margin:2px}
    .cb{width:20px;height:20px;border:2px solid #ccc;border-radius:4px;display:inline-block}
    @media print{body{padding:10px}}
  </style></head><body>
  <h1>📋 今日总拣货清单</h1>
  <div class="sub">${new Date().toLocaleDateString()} · 共 ${pickList.length} 种商品 · ${pickList.reduce((s,p)=>s+p.totalQty,0)} 件</div>
  <table>
    <tr><th>#</th><th>核对</th><th>商品名称</th><th>变体</th><th>总数量</th><th>库位</th><th>来源订单</th></tr>
    ${pickList.map((item,i)=>`
    <tr>
      <td><span class="num">${i+1}</span></td>
      <td><span class="cb"></span></td>
      <td><strong>${item.name}</strong></td>
      <td style="color:#FF6B35">${item.variant}</td>
      <td class="qty">${item.totalQty}</td>
      <td><span class="loc">${item.location||'—'}</span></td>
      <td>${item.orders.map(o=>`<span class="plat" style="background:#EE4D2D;color:#fff">${o.platform.split(' ')[0]}(${o.qty})</span>`).join('')}</td>
    </tr>`).join('')}
  </table>
  <script>window.onload=()=>window.print()</script>
  </body></html>`)
  w.document.close()
}

function PlatformBadge({ platform, size='sm' }) {
  const cfg = PLATFORMS[platform] || { color:'#666', bg:'#eee', icon:'🏪' }
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:3,
      background:cfg.bg, color:cfg.color, border:`1px solid ${cfg.color}40`,
      borderRadius:20, padding: size==='sm'?'2px 8px':'4px 12px',
      fontSize: size==='sm'?10:12, fontWeight:700, whiteSpace:'nowrap' }}>
      {cfg.icon} {platform}
    </span>
  )
}

// ── Excel order import parser ─────────────────────────────────
function parseShopeeOrderXlsx(buffer, platform) {
  const wb    = XLSX.read(new Uint8Array(buffer), { type:'array' })
  const ws    = wb.Sheets[wb.SheetNames[0]]
  const raw   = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })
  let hIdx = -1
  for (let i=0;i<Math.min(raw.length,10);i++) {
    if (raw[i].some(c=>String(c).includes('Order ID')||String(c).includes('order_id')||String(c).includes('orderNumber'))) {
      hIdx=i; break
    }
  }
  if (hIdx<0) return []
  const headers = raw[hIdx].map(h=>String(h).trim())
  const rows = []
  for (let i=hIdx+1;i<raw.length;i++) {
    const r=raw[i]; if (!r[0]||String(r[0]).trim()==='') continue
    const obj={}; headers.forEach((h,j)=>{ obj[h]=String(r[j]||'').trim() })
    rows.push(obj)
  }
  // Map to our order format
  return rows.map(r=>({
    id:         r['Order ID']||r['order_id']||r['orderNumber']||crypto.randomUUID().slice(0,8),
    platform,
    status:     'unprocessed',
    customer:   r['Buyer Username']||r['buyerName']||'',
    total:      parseFloat(r['Order Total']||r['total']||'0')||0,
    created_at: r['Order Creation Date']||r['createdAt']||new Date().toISOString(),
    items:[{
      sku:          r['SKU Reference No.']||r['SellerSKU']||r['sellerSku']||'',
      name:         r['Product Name']||r['name']||'',
      variant_name: r['Variation Name']||r['variationName']||'',
      qty:          parseInt(r['Quantity']||r['qty']||'1')||1,
      unit_price:   parseFloat(r['Original Price']||r['unitPrice']||'0')||0,
      location:     '',
    }]
  }))
}

// ════════════════════════════════════════════════════════════════
export default function OrdersPage({ orders, counts, loading, markProcessed, markReturn,
                                     restoreStock, shout, products, fetchOrders }) {
  const [orderTab,     setOrderTab]     = useState('unprocessed')
  const [checked,      setChecked]      = useState({})
  const [showPickList, setShowPickList] = useState(true)
  const [showImport,   setShowImport]   = useState(false)
  const [importPlat,   setImportPlat]   = useState('Shopee SG')
  const [returnModal,  setReturnModal]  = useState(null)
  const [returnReason, setReturnReason] = useState('')
  const [searchQ,      setSearchQ]      = useState('')
  const fileRef = useRef()

  const pickList = useMemo(()=>buildPickList(orders),[orders])

  const filteredOrders = useMemo(()=>{
    let list = orders.filter(o=>o.status===orderTab)
    if (searchQ) {
      const q = searchQ.toLowerCase()
      list = list.filter(o=>
        o.id.toLowerCase().includes(q)||
        (o.customer||'').toLowerCase().includes(q)||
        (o.order_items||[]).some(i=>(i.name||'').toLowerCase().includes(q))
      )
    }
    return list
  },[orders,orderTab,searchQ])

  const unprocessed = orders.filter(o=>o.status==='unprocessed')

  const handleMarkReturn = async () => {
    if (!returnModal) return
    const ok = await markReturn(returnModal, returnReason)
    if (ok) { shout(`订单 #${returnModal} 已标记退货`); setReturnModal(null); setReturnReason('') }
    else shout('操作失败',true)
  }

  const handleRestoreStock = async (orderId) => {
    const ok = await restoreStock(orderId)
    if (ok) shout(`退货库存已恢复 ✓`)
    else shout('库存恢复失败',true)
  }

  const handleBatchProcess = async () => {
    const ids = Object.keys(checked).filter(id=>checked[id])
    if (!ids.length) { shout('请先勾选订单',true); return }
    for (const id of ids) await markProcessed(id)
    setChecked({})
    shout(`✓ ${ids.length} 张订单已标记发货`)
  }

  // ── Import from Excel ────────────────────────────────────────
  const handleImportFile = async (e) => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      try {
        const parsed = parseShopeeOrderXlsx(ev.target.result, importPlat)
        if (parsed.length===0) { shout('无法读取订单数据',true); return }
        // TODO: import to Supabase via importOrders()
        shout(`解析到 ${parsed.length} 张订单（功能开发中，请手动导入）`)
      } catch(e) { shout('文件读取失败：'+e.message,true) }
    }
    reader.readAsArrayBuffer(file)
  }

  if (loading) return (
    <div style={{textAlign:'center',padding:'60px 20px',color:C.slate}}>
      <div style={{fontSize:32,marginBottom:8}}>⏳</div>
      <div>加载订单中…</div>
    </div>
  )

  return (
    <div>
      {/* ── Status tab pills ─────────────────────────────────── */}
      <div style={{display:'flex',gap:6,marginBottom:12,overflowX:'auto',paddingBottom:2}}>
        {[
          ['unprocessed',`🔴 未处理`,C.red],
          ['processed',  `✅ 已处理`,C.green],
          ['return',     `↩ 退货`,  C.yellow],
        ].map(([id,label,col])=>(
          <button key={id} onClick={()=>setOrderTab(id)}
            style={{padding:'8px 14px',borderRadius:20,border:'none',cursor:'pointer',
              whiteSpace:'nowrap',fontWeight:orderTab===id?700:400,fontSize:12,
              background:orderTab===id?col:C.cream,
              color:orderTab===id?'#fff':C.slate,flexShrink:0}}>
            {label}
            <span style={{marginLeft:5,opacity:.8}}>({counts[id]||0})</span>
          </button>
        ))}
        {/* Import button */}
        <button onClick={()=>setShowImport(p=>!p)}
          style={{...S.btn(C.blue,false,true),flexShrink:0,marginLeft:'auto'}}>
          📥 导入
        </button>
      </div>

      {/* ── Import panel ─────────────────────────────────────── */}
      {showImport&&(
        <div style={{...S.card,border:`1px solid ${C.blue}30`,marginBottom:12}}>
          <div style={S.secTitle}>导入平台订单 Excel</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
            {Object.keys(PLATFORMS).map(p=>(
              <button key={p} onClick={()=>setImportPlat(p)}
                style={{padding:'5px 12px',borderRadius:20,border:'none',cursor:'pointer',
                  background:importPlat===p?(PLATFORMS[p].color):'#f0f0f0',
                  color:importPlat===p?'#fff':C.slate,fontSize:11,fontWeight:importPlat===p?700:400}}>
                {PLATFORMS[p].icon} {p}
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
            onChange={handleImportFile}/>
          <button onClick={()=>fileRef.current?.click()} style={S.btn(C.blue)}>
            📄 选择 Excel 文件导入
          </button>
          <div style={{fontSize:10,color:C.slateLight,marginTop:6,lineHeight:1.7}}>
            支持 Shopee / Lazada 订单导出文件（Excel/CSV）<br/>
            系统自动识别订单号、产品、数量、客户信息
          </div>
        </div>
      )}

      {/* ── Pick list (unprocessed only) ─────────────────────── */}
      {orderTab==='unprocessed'&&pickList.length>0&&(
        <div style={{marginBottom:14}}>
          <button onClick={()=>setShowPickList(p=>!p)}
            style={{width:'100%',padding:'12px 16px',border:'none',cursor:'pointer',
              display:'flex',justifyContent:'space-between',alignItems:'center',
              background:C.navy,borderRadius:showPickList?'12px 12px 0 0':12,color:'#fff'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{color:C.orange,fontWeight:700,fontSize:14}}>📋 今日总拣货清单</span>
              <span style={{background:C.orange,color:'#fff',borderRadius:12,padding:'1px 8px',fontSize:11,fontWeight:700}}>
                {pickList.length} 种 · {pickList.reduce((s,p)=>s+p.totalQty,0)} 件
              </span>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <button onClick={e=>{e.stopPropagation();printPickList(pickList)}}
                style={{background:C.orange,color:'#fff',border:'none',borderRadius:6,
                       padding:'4px 10px',fontSize:11,cursor:'pointer',fontWeight:700}}>
                🖨️ 打印清单
              </button>
              <span style={{color:C.slateLight}}>{showPickList?'▲':'▼'}</span>
            </div>
          </button>

          {showPickList&&(
            <div style={{background:'#fff',borderRadius:'0 0 12px 12px',
                         boxShadow:'0 3px 12px rgba(0,0,0,.08)',overflow:'hidden'}}>
              {/* Column headers */}
              <div style={{display:'grid',gridTemplateColumns:'28px 42px 1fr 52px 76px',
                           gap:6,padding:'7px 10px',background:C.navyLight}}>
                {['#','','商品 · 变体','总量','库位'].map((h,i)=>(
                  <div key={i} style={{fontSize:9,color:C.slateLight,fontWeight:700,
                                       textAlign:i===3?'center':'left'}}>{h}</div>
                ))}
              </div>

              {pickList.map((item,idx)=>(
                <div key={`${item.sku}${idx}`}
                  style={{display:'grid',gridTemplateColumns:'28px 42px 1fr 52px 76px',
                          gap:6,padding:'9px 10px',alignItems:'center',
                          borderBottom:`1px solid ${C.cream}`,
                          background:idx%2===0?'#fff':'#FAFAFA'}}>
                  <div style={{width:22,height:22,borderRadius:'50%',background:C.orange,
                               color:'#fff',display:'flex',alignItems:'center',
                               justifyContent:'center',fontSize:10,fontWeight:900}}>
                    {idx+1}
                  </div>
                  {item.photo
                    ? <img src={item.photo} onError={e=>e.target.style.display='none'}
                        style={{width:38,height:38,borderRadius:6,objectFit:'cover'}} alt=""/>
                    : <div style={{width:38,height:38,borderRadius:6,background:C.cream,
                                   display:'flex',alignItems:'center',justifyContent:'center'}}>📦</div>}
                  <div>
                    <div style={{fontSize:11,fontWeight:700,lineHeight:1.3,marginBottom:2}}>
                      {item.name}
                    </div>
                    <div style={{fontSize:10,color:C.orange,marginBottom:3}}>{item.variant}</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:2}}>
                      {item.orders.map((o,i)=>(
                        <span key={i} style={{
                          background:(PLATFORMS[o.platform]||{color:C.slate}).color,
                          color:'#fff',borderRadius:10,padding:'1px 6px',
                          fontSize:9,fontWeight:700}}>
                          {o.platform.replace('Shopee','SHP').replace('Lazada','LZ')} ({o.qty})
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:26,fontWeight:900,color:C.navy,lineHeight:1}}>{item.totalQty}</div>
                    <div style={{fontSize:8,color:C.slate}}>件</div>
                  </div>
                  <div style={{background:C.navy,color:C.orange,borderRadius:8,
                               padding:'4px 6px',textAlign:'center',fontSize:10,fontWeight:700}}>
                    {item.location||'待设置'}
                  </div>
                </div>
              ))}

              {/* Bulk print */}
              <div style={{padding:'10px',borderTop:`1px solid ${C.cream}`,display:'flex',gap:8}}>
                <button onClick={()=>unprocessed.forEach((o,i)=>setTimeout(()=>printSlip(o),i*400))}
                  style={S.btn(C.navy)}>
                  🖨️ 一键打印全部面单 ({unprocessed.length})
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Search ───────────────────────────────────────────── */}
      <div style={{marginBottom:10}}>
        <input style={S.inp} placeholder="搜索订单号 / 客户名 / 产品…"
          value={searchQ} onChange={e=>setSearchQ(e.target.value)}/>
      </div>

      {/* ── Order count + batch action ────────────────────────── */}
      {orderTab==='unprocessed'&&filteredOrders.length>0&&(
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{fontSize:11,color:C.slate}}>
            {filteredOrders.length} 张订单 ·
            <span style={{color:C.orange,marginLeft:4}}>
              {Object.values(checked).filter(Boolean).length} 已勾选
            </span>
          </div>
          <button onClick={handleBatchProcess}
            style={{...S.btn(C.green,false,true)}}>
            ✅ 批量发货
          </button>
        </div>
      )}

      {/* ── Order cards ──────────────────────────────────────── */}
      {filteredOrders.length===0&&(
        <div style={{...S.card,textAlign:'center',padding:'32px',color:C.slate}}>
          <div style={{fontSize:32,marginBottom:8}}>
            {orderTab==='unprocessed'?'🎉':orderTab==='processed'?'📋':'📦'}
          </div>
          <div style={{fontSize:13}}>
            {orderTab==='unprocessed'?'没有待处理订单':
             orderTab==='processed'?'暂无已处理订单':'暂无退货记录'}
          </div>
        </div>
      )}

      {filteredOrders.map(order=>{
        const plat     = PLATFORMS[order.platform]||{}
        const items    = order.order_items||[]
        const isChk    = checked[order.id]

        return (
          <div key={order.id} style={{
            ...S.card,
            border:`2px solid ${isChk?C.green:plat.color||C.slateLight}25`,
            background: isChk?C.green+'05':'#fff',
            transition:'all .15s'
          }}>
            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',
                         alignItems:'flex-start',marginBottom:10}}>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                {/* Checkbox */}
                {orderTab==='unprocessed'&&(
                  <div onClick={()=>setChecked(prev=>({...prev,[order.id]:!prev[order.id]}))}
                    style={{width:20,height:20,borderRadius:5,cursor:'pointer',flexShrink:0,
                            border:`2px solid ${isChk?C.green:C.slateLight}`,
                            background:isChk?C.green:'#fff',
                            display:'flex',alignItems:'center',justifyContent:'center'}}>
                    {isChk&&<span style={{color:'#fff',fontSize:12,fontWeight:900}}>✓</span>}
                  </div>
                )}
                <PlatformBadge platform={order.platform}/>
                <span style={{fontSize:14,fontWeight:900,color:C.navy}}>#{order.id}</span>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:11,color:C.slate}}>
                  {new Date(order.created_at||Date.now()).toLocaleDateString()}
                </div>
                <div style={{fontSize:11,color:C.slate,marginTop:1}}>{order.customer||'—'}</div>
              </div>
            </div>

            {/* Items */}
            {items.map((item,i)=>{
              const prod = item.products || {}
              return (
                <div key={i} style={{display:'flex',gap:10,alignItems:'center',
                                     padding:'10px',background:C.cream,borderRadius:10,
                                     marginBottom:i<items.length-1?6:0}}>
                  {(prod.photo_url||item.photo)
                    ? <img src={prod.photo_url||item.photo}
                        onError={e=>e.target.style.display='none'}
                        style={{width:52,height:52,borderRadius:9,objectFit:'cover',flexShrink:0}} alt=""/>
                    : <div style={{width:52,height:52,borderRadius:9,background:'#ddd',
                                   display:'flex',alignItems:'center',justifyContent:'center',
                                   fontSize:22,flexShrink:0}}>📦</div>}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:700,lineHeight:1.3,marginBottom:2}}>
                      {item.name||prod.name||'—'}
                    </div>
                    <div style={{fontSize:11,color:C.orange,fontWeight:600,marginBottom:4}}>
                      {item.variant_name||prod.variant_name||'—'}
                    </div>
                    {item.location&&(
                      <div style={{display:'inline-block',background:C.navy,color:C.orange,
                                   borderRadius:6,padding:'2px 8px',fontSize:10,fontWeight:700}}>
                        📍 {item.location}
                      </div>
                    )}
                    {order.return_reason&&(
                      <div style={{fontSize:10,color:C.yellow,marginTop:4}}>
                        ↩ {order.return_reason}
                      </div>
                    )}
                  </div>
                  <div style={{textAlign:'center',flexShrink:0}}>
                    <div style={{fontSize:34,fontWeight:900,color:C.navy,lineHeight:1}}>{item.qty}</div>
                    <div style={{fontSize:9,color:C.slate}}>件</div>
                  </div>
                </div>
              )
            })}

            {/* Total */}
            {order.total>0&&(
              <div style={{textAlign:'right',fontSize:12,color:C.slate,marginTop:6}}>
                合计：<strong style={{color:C.navy}}>
                  {order.platform?.includes('MY')?'RM':'SGD'} {(order.total||0).toFixed(2)}
                </strong>
              </div>
            )}

            {/* Stock restored badge */}
            {order.stock_restored&&(
              <div style={{...S.tag(C.green),padding:'4px 10px',marginTop:6,display:'inline-block'}}>
                ✓ 退货已入库
              </div>
            )}

            {/* Actions */}
            <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
              <button onClick={()=>printSlip(order)}
                style={S.btn(C.navyMid,false,true)}>
                🖨️ 打印面单
              </button>
              {orderTab==='unprocessed'&&(
                <>
                  <button onClick={()=>{ markProcessed(order.id); shout(`#${order.id} 已发货 ✓`) }}
                    style={S.btn(C.green,false,true)}>
                    ✅ 确认发货
                  </button>
                  <button onClick={()=>setReturnModal(order.id)}
                    style={S.btn(C.yellow,false,true)}>
                    ↩ 退货
                  </button>
                </>
              )}
              {orderTab==='return'&&!order.stock_restored&&(
                <button onClick={()=>handleRestoreStock(order.id)}
                  style={S.btn(C.orange,false,true)}>
                  📦 退货入库（恢复库存）
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* ── Return reason modal ───────────────────────────────── */}
      {returnModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',
                     zIndex:9000,display:'flex',alignItems:'flex-end',justifyContent:'center'}}
          onClick={e=>{if(e.target===e.currentTarget){setReturnModal(null);setReturnReason('')}}}>
          <div style={{background:'#fff',borderRadius:'16px 16px 0 0',padding:'20px 16px 32px',
                       width:'100%',maxWidth:430}}>
            <div style={{width:36,height:4,background:C.slateLight+'60',borderRadius:2,margin:'0 auto 16px'}}/>
            <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>↩ 标记退货 — #{returnModal}</div>
            <label style={S.lbl}>退货原因（选填）</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
              {['产品破损','发错货','客户不满意','质量问题','其他'].map(r=>(
                <button key={r} onClick={()=>setReturnReason(r)}
                  style={{padding:'5px 12px',borderRadius:20,border:`1px solid ${returnReason===r?C.orange:C.slateLight+'50'}`,
                    background:returnReason===r?C.orange+'12':'#fff',
                    color:returnReason===r?C.orange:C.slate,fontSize:11,cursor:'pointer'}}>
                  {r}
                </button>
              ))}
            </div>
            <input style={{...S.inp,marginBottom:14}} placeholder="或输入自定义原因…"
              value={returnReason} onChange={e=>setReturnReason(e.target.value)}/>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>{setReturnModal(null);setReturnReason('')}}
                style={S.btn(C.slate,false)}>取消</button>
              <button onClick={handleMarkReturn}
                style={S.btn(C.yellow)}>↩ 确认退货</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
