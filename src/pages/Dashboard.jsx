// src/pages/Dashboard.jsx — 带筛选功能
import { useState, useMemo } from 'react'
import { C, S, StatusBadge } from '../App'

const PLATFORMS = ['全部','Shopee SG','Shopee MY','Lazada MY','Lazada SG','多平台']
const STOCK_FILTERS = [{id:'all',label:'全部'},{id:'low',label:'需补货'},{id:'out',label:'缺货'},{id:'ok',label:'充足'}]

const daysUntil = d => d ? Math.ceil((new Date(d) - new Date()) / 864e5) : null
const expColor  = days => days<=0?C.red:days<=14?C.red:days<=30?C.yellow:C.green
const currency  = p => (p||'').toLowerCase().includes('my') ? 'RM' : 'SGD'

function Pill({active,onClick,children,color=C.orange}){
  return <button onClick={onClick} style={{padding:'5px 12px',borderRadius:20,border:`1.5px solid ${active?color:C.slateLight+'50'}`,background:active?color:'#fff',color:active?'#fff':C.slate,fontSize:11,fontWeight:active?700:400,cursor:'pointer',whiteSpace:'nowrap'}}>{children}</button>
}

export default function Dashboard({ products, batches, suppliers, purchaseOrders,
                                    totalStock, setTab, shout }) {
  const [platFilter,  setPlatFilter]  = useState('全部')
  const [stockFilter, setStockFilter] = useState('all')
  const [showFilter,  setShowFilter]  = useState(false)

  const today = new Date()

  // Expiry alerts (all products)
  const expiryAlerts = useMemo(() => {
    const alerts = []
    products.forEach(p => {
      if (!p.has_expiry) return
      batches.filter(b => b.product_id === p.id && b.expiry_date && b.qty > 0).forEach(b => {
        const days = daysUntil(b.expiry_date)
        if (days !== null && days <= 30) alerts.push({ product: p, batch: b, days })
      })
    })
    return alerts.sort((a, b) => a.days - b.days)
  }, [products, batches])

  // Filtered products for stock list
  const filtered = useMemo(() => {
    let list = products.filter(p => !p.parent_id) // parents only
    if (platFilter !== '全部')
      list = list.filter(p => (p.platform||'').includes(platFilter.replace('全部','')))
    if (stockFilter !== 'all') {
      list = list.filter(p => {
        const s = totalStock(p.id)
        const st = s<=0?'out':s<p.min_stock?'low':'ok'
        return st === stockFilter
      })
    }
    return list
  }, [products, batches, platFilter, stockFilter])

  const activeFilters = [platFilter!=='全部', stockFilter!=='all'].filter(Boolean).length
  const totalValue = products.reduce((s,p)=>s+totalStock(p.id)*(p.cost||0), 0)
  const lowCount   = products.filter(p=>totalStock(p.id)<p.min_stock).length

  return (
    <div>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
        {[
          [products.length,         '产品 SKU',  C.navy],
          [`SGD/RM ${totalValue.toFixed(0)}`, '库存价值', C.navy],
          [lowCount,                '需补货',   lowCount>0?C.red:C.navyMid],
          [expiryAlerts.length,     '效期预警', expiryAlerts.length>0?C.purple:C.navyMid],
        ].map(([v,l,bg])=>(
          <div key={l} style={{background:bg,borderRadius:12,padding:'14px 16px'}}>
            <div style={{fontSize:26,fontWeight:900,color:C.orange,lineHeight:1}}>{v}</div>
            <div style={{fontSize:11,color:C.slateLight,marginTop:4}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Expiry alerts */}
      {expiryAlerts.length > 0 && (
        <div style={{...S.card,border:`1px solid ${C.purple}30`}}>
          <div style={{fontSize:12,fontWeight:700,color:C.purple,marginBottom:8}}>⏰ 效期提醒</div>
          {expiryAlerts.slice(0,4).map((a,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                paddingBottom:8,marginBottom:8,borderBottom:i<3?`1px solid ${C.cream}`:'none'}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                {a.product.photo_url&&<img src={a.product.photo_url} onError={e=>e.target.style.display='none'}
                  style={{width:30,height:30,borderRadius:6,objectFit:'cover'}} alt=""/>}
                <div>
                  <div style={{fontSize:12,fontWeight:600}}>{a.product.name} {a.product.variant_name}</div>
                  <div style={{fontSize:10,color:C.slate}}>{a.batch.batch_no} · {a.batch.qty}件</div>
                </div>
              </div>
              <div style={{fontSize:12,fontWeight:900,color:expColor(a.days),textAlign:'right'}}>
                {a.days<=0?'已过期':`${a.days}天`}
                <div style={{fontSize:10,color:C.slate,fontWeight:400}}>{a.batch.expiry_date}</div>
              </div>
            </div>
          ))}
          <a href={`https://wa.me/?text=${encodeURIComponent(
            `⏰ StockEasy 效期提醒\n${expiryAlerts.slice(0,5).map(a=>`• ${a.product.name} ${a.product.variant_name||''} — ${a.days<=0?'已过期':`${a.days}天到期`} (${a.batch.qty}件)`).join('\n')}`
          )}`} target="_blank" rel="noreferrer"
            style={{...S.btn(C.green,true,true),display:'block',textDecoration:'none',textAlign:'center',marginTop:8}}>
            📲 WhatsApp 发送提醒
          </a>
        </div>
      )}

      {/* Stock list with filter */}
      <div style={S.card}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={S.secTitle}>库存总览</div>
          <button onClick={()=>setShowFilter(f=>!f)}
            style={{...S.btn(showFilter?C.orange:C.navyMid,false,true)}}>
            🔽 筛选{activeFilters>0?` (${activeFilters})`:''}
          </button>
        </div>

        {/* Filter panel */}
        {showFilter&&(
          <div style={{background:C.cream,borderRadius:10,padding:'12px',marginBottom:12}}>
            <div style={{marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>平台</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {PLATFORMS.map(p=><Pill key={p} active={platFilter===p} onClick={()=>setPlatFilter(p)} color={C.blue}>{p}</Pill>)}
              </div>
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>库存状态</div>
              <div style={{display:'flex',gap:5}}>
                {STOCK_FILTERS.map(f=><Pill key={f.id} active={stockFilter===f.id} onClick={()=>setStockFilter(f.id)} color={C.red}>{f.label}</Pill>)}
              </div>
            </div>
            {activeFilters>0&&(
              <button onClick={()=>{setPlatFilter('全部');setStockFilter('all')}}
                style={{...S.btn(C.slate,true,true),marginTop:8}}>✕ 清除筛选</button>
            )}
          </div>
        )}

        <div style={{fontSize:11,color:C.slate,marginBottom:8}}>
          显示 {filtered.length} / {products.filter(p=>!p.parent_id).length} 个产品
        </div>

        {filtered.map((p,i)=>{
          const stock = totalStock(p.id)
          const cur   = currency(p.platform)
          const nearExp = batches.filter(b=>b.product_id===p.id&&b.expiry_date&&b.qty>0)
            .sort((a,b)=>a.expiry_date.localeCompare(b.expiry_date))[0]
          const expDays = nearExp ? daysUntil(nearExp.expiry_date) : null

          return (
            <div key={p.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                paddingBottom:10,marginBottom:10,borderBottom:i<filtered.length-1?`1px solid ${C.cream}`:'none',
                cursor:'pointer'}}
              onClick={()=>setTab('scan')}>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                {p.photo_url
                  ? <img src={p.photo_url} onError={e=>e.target.style.display='none'}
                      style={{width:40,height:40,borderRadius:8,objectFit:'cover'}} alt=""/>
                  : <div style={{width:40,height:40,borderRadius:8,background:C.cream,display:'flex',alignItems:'center',justifyContent:'center'}}>📦</div>}
                <div>
                  <div style={{fontSize:13,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:180}}>{p.name}</div>
                  <div style={{fontSize:10,color:C.slate}}>{p.variant_name||''} · {cur}</div>
                  {expDays!==null&&expDays<=30&&(
                    <div style={{fontSize:10,color:expColor(expDays),fontWeight:600}}>
                      ⏰ {expDays<=0?'批次已过期':`${expDays}天到期`}
                    </div>
                  )}
                </div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:18,fontWeight:900,color:stock<p.min_stock?C.red:C.navy}}>{stock}</div>
                <StatusBadge stock={stock} min={p.min_stock}/>
              </div>
            </div>
          )
        })}

        {filtered.length===0&&(
          <div style={{textAlign:'center',padding:'20px',color:C.slate}}>
            <div>没有符合的产品</div>
            <button onClick={()=>{setPlatFilter('全部');setStockFilter('all')}}
              style={{...S.btn(C.orange,false,true),marginTop:8}}>清除筛选</button>
          </div>
        )}
      </div>

      {/* Low stock CTA */}
      {lowCount>0&&(
        <button onClick={()=>setTab('purchase')} style={S.btn(C.orange)}>
          📋 开入货单（{lowCount} 种需补货）
        </button>
      )}
    </div>
  )
}
