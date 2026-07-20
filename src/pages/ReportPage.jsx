// src/pages/ReportPage.jsx — 带筛选和SGD/RM货币
import { useState, useMemo, useEffect } from 'react'
import { C, S } from '../App'
import { supabase } from '../lib/supabase'

const PLATFORMS = ['全部','Shopee SG','Shopee MY','Lazada MY','Lazada SG']
const PERIODS   = [{id:'7',label:'7天'},{id:'30',label:'30天'},{id:'90',label:'90天'},{id:'365',label:'全年'}]

const currency = p => (p||'').toLowerCase().includes('my') ? 'RM' : 'SGD'
const daysUntil = d => d ? Math.ceil((new Date(d)-new Date())/864e5) : null

function Pill({active,onClick,children,color=C.orange}){
  return <button onClick={onClick} style={{padding:'5px 12px',borderRadius:20,border:`1.5px solid ${active?color:C.slateLight+'50'}`,background:active?color:'#fff',color:active?'#fff':C.slate,fontSize:11,fontWeight:active?700:400,cursor:'pointer',whiteSpace:'nowrap'}}>{children}</button>
}

export default function ReportPage({ products, batches, purchaseOrders, totalStock, orders=[], shout }) {
  const [period,     setPeriod]     = useState('30')
  const [platFilter, setPlatFilter] = useState('全部')
  const [shopFilter, setShopFilter] = useState('all')
  const [sortBy,     setSortBy]     = useState('value') // value | stock | expiry_risk
  const [shops,      setShops]      = useState([])

  useEffect(() => {
    supabase.from('shops').select('id,platform,shop_code,shop_name').order('platform').order('shop_code')
      .then(({ data, error }) => { if (!error) setShops(data||[]) })
  }, [])
  const shopsForPlat = shops.filter(s => platFilter==='全部' || s.platform===platFilter)

  // ── 平台费率（净利润计算要用）─────────────────────────────
  const DEFAULT_RULE = { commission_pct:0, payment_fee_pct:0, fixed_shipping_fee:0 }
  const [feeRules,   setFeeRules]   = useState({}) // { 'Shopee SG': {commission_pct,payment_fee_pct,fixed_shipping_fee}, ... }
  const [showFeeCfg, setShowFeeCfg] = useState(false)
  const [savingFee,  setSavingFee]  = useState(false)

  useEffect(() => {
    supabase.from('platform_fee_rules').select('*').then(({ data, error }) => {
      if (error) { console.error('读取平台费率失败:', error); return }
      const map = {}
      ;(data||[]).forEach(r => { map[r.platform] = r })
      setFeeRules(map)
    })
  }, [])

  const saveFeeRule = async (platform, patch) => {
    const next = { ...(feeRules[platform]||DEFAULT_RULE), ...patch, platform }
    setFeeRules(f => ({ ...f, [platform]: next }))
  }

  const handleSaveAllFees = async () => {
    setSavingFee(true)
    try {
      const rows = Object.entries(feeRules).map(([platform, r]) => ({
        platform,
        commission_pct:     parseFloat(r.commission_pct)     || 0,
        payment_fee_pct:    parseFloat(r.payment_fee_pct)    || 0,
        fixed_shipping_fee: parseFloat(r.fixed_shipping_fee) || 0,
      }))
      const { error } = await supabase.from('platform_fee_rules').upsert(rows, { onConflict:'platform' })
      if (error) throw error
      shout && shout('费率已保存 ✓')
    } catch(e) {
      shout ? shout('保存失败：'+e.message, true) : console.error(e)
    }
    setSavingFee(false)
  }

  const today  = new Date()
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - parseInt(period))

  // Filter products by platform + shop
  const filteredProducts = useMemo(() => {
    let list = platFilter === '全部' ? products
      : products.filter(p => (p.platform||'').includes(platFilter.replace('全部','')))
    if (shopFilter !== 'all') list = list.filter(p => p.shop_id === shopFilter)
    return list
  }, [products, platFilter, shopFilter])

  // Inventory value by currency
  const sgdProducts = filteredProducts.filter(p => currency(p.platform)==='SGD')
  const myrProducts = filteredProducts.filter(p => currency(p.platform)==='RM')
  const sgdValue = sgdProducts.reduce((s,p)=>s+totalStock(p.id)*(p.cost||0),0)
  const myrValue = myrProducts.reduce((s,p)=>s+totalStock(p.id)*(p.cost||0),0)

  // Expiry risk value
  const expiryRisk = filteredProducts.reduce((s,p)=>{
    const risk = batches.filter(b=>b.product_id===p.id&&b.expiry_date&&b.qty>0)
      .filter(b=>daysUntil(b.expiry_date)<=30)
      .reduce((s,b)=>s+b.qty*(p.cost||0),0)
    return s+risk
  },0)

  // Product stats with sort
  const productStats = useMemo(()=>{
    const stats = filteredProducts.map(p=>{
      const stock = totalStock(p.id)
      const value = stock*(p.cost||0)
      const cur   = currency(p.platform)
      const risk  = batches.filter(b=>b.product_id===p.id&&b.expiry_date&&b.qty>0)
        .filter(b=>daysUntil(b.expiry_date)<=30)
        .reduce((s,b)=>s+b.qty*(p.cost||0),0)
      return {...p, stock, value, cur, expiryRisk:risk}
    }).filter(p=>p.stock>0)

    if (sortBy==='value')       return [...stats].sort((a,b)=>b.value-a.value)
    if (sortBy==='stock')       return [...stats].sort((a,b)=>b.stock-a.stock)
    if (sortBy==='expiry_risk') return [...stats].sort((a,b)=>b.expiryRisk-a.expiryRisk)
    return stats
  },[filteredProducts,batches,sortBy])

  // Recent POs
  const recentPOs = purchaseOrders.filter(po=>new Date(po.order_date)>=cutoff)
  const poTotal   = recentPOs.reduce((s,po)=>{
    return s+(po.po_items||[]).reduce((s2,i)=>s2+i.qty*(i.cost||0),0)
  },0)

  // ── 销售额 / 成本 / 净利润（按币种拆分）──────────────────────
  const productById = useMemo(()=> new Map(products.map(p=>[p.id,p])), [products])

  const profitStats = useMemo(() => {
    const empty = () => ({ revenue:0, cogs:0, fees:0, unmatchedItems:0 })
    const byCur = { SGD: empty(), RM: empty() }

    const periodOrders = (orders||[]).filter(o => {
      if (!o.created_at || new Date(o.created_at) < cutoff) return false
      if (o.status === 'return') return false   // 退货不计入营收
      if (platFilter !== '全部' && !(o.platform||'').includes(platFilter)) return false
      if (shopFilter !== 'all' && o.shop_id !== shopFilter) return false
      return true
    })

    periodOrders.forEach(o => {
      const cur  = currency(o.platform)
      const rule = feeRules[o.platform] || DEFAULT_RULE
      let orderRevenue = 0
      ;(o.order_items||[]).forEach(it => {
        const rev = (it.qty||0)*(it.unit_price||0)
        orderRevenue += rev
        byCur[cur].revenue += rev
        const prod = it.product_id ? productById.get(it.product_id) : null
        if (prod) byCur[cur].cogs += (it.qty||0)*(prod.cost||0)
        else      byCur[cur].unmatchedItems += 1
      })
      byCur[cur].fees += orderRevenue*((rule.commission_pct||0)/100)
                       + orderRevenue*((rule.payment_fee_pct||0)/100)
                       + (rule.fixed_shipping_fee||0)
    })

    return byCur
  }, [orders, cutoff, platFilter, shopFilter, feeRules, productById])

  const maxVal = Math.max(...productStats.map(p=>p.value),1)

  return (
    <div>
      {/* Period + Platform filter */}
      <div style={{...S.card,padding:'12px 14px'}}>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>时间段</div>
          <div style={{display:'flex',gap:6}}>
            {PERIODS.map(p=><Pill key={p.id} active={period===p.id} onClick={()=>setPeriod(p.id)}>{p.label}</Pill>)}
          </div>
        </div>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>平台筛选</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
            {PLATFORMS.map(p=><Pill key={p} active={platFilter===p} onClick={()=>{setPlatFilter(p);setShopFilter('all')}} color={C.blue}>{p}</Pill>)}
          </div>
        </div>
        {shopsForPlat.length>0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>店铺筛选</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              <Pill active={shopFilter==='all'} onClick={()=>setShopFilter('all')} color={C.navy}>全部店铺</Pill>
              {shopsForPlat.map(s=>(
                <Pill key={s.id} active={shopFilter===s.id} onClick={()=>setShopFilter(s.id)} color={C.navy}>
                  🏪 {s.shop_name || `${s.platform.includes('MY')?'MY':'SG'} 店${s.shop_code}`}
                </Pill>
              ))}
            </div>
          </div>
        )}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>排序</div>
          <div style={{display:'flex',gap:5}}>
            {[['value','库存价值'],['stock','库存数量'],['expiry_risk','效期风险']].map(([id,l])=>(
              <Pill key={id} active={sortBy===id} onClick={()=>setSortBy(id)} color={C.purple}>{l}</Pill>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards — split by currency */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
        {[
          [`SGD ${sgdValue.toFixed(0)}`, 'SG 库存价值',   C.blue],
          [`RM ${myrValue.toFixed(0)}`,  'MY 库存价值',   C.navy],
          [filteredProducts.filter(p=>totalStock(p.id)>0).length, '有库存产品', C.navyMid],
          [`RM/SGD ${expiryRisk.toFixed(0)}`, '效期风险值', expiryRisk>0?C.red:C.navyMid],
        ].map(([v,l,bg])=>(
          <div key={l} style={{background:bg,borderRadius:12,padding:'14px 16px'}}>
            <div style={{fontSize:20,fontWeight:900,color:C.orange,lineHeight:1}}>{v}</div>
            <div style={{fontSize:11,color:C.slateLight,marginTop:4}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Purchase summary */}
      {recentPOs.length>0&&(
        <div style={{...S.card,background:C.navy,marginBottom:14}}>
          <div style={{color:C.slateLight,fontSize:11,marginBottom:4}}>过去 {period} 天入货</div>
          <div style={{color:C.orange,fontSize:24,fontWeight:900}}>RM/SGD {poTotal.toFixed(2)}</div>
          <div style={{color:C.slateLight,fontSize:11,marginTop:4}}>{recentPOs.length} 张入货单</div>
        </div>
      )}

      {/* ── 净利润报表 ──────────────────────────────────────── */}
      <div style={S.card}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={S.secTitle}>销售毛利 / 净利润 · 过去 {period} 天</div>
          <button onClick={()=>setShowFeeCfg(v=>!v)}
            style={{background:'none',border:`1px solid ${C.slate}40`,borderRadius:6,
                   padding:'3px 9px',fontSize:10,color:C.slate,cursor:'pointer'}}>
            ⚙ 平台费率{showFeeCfg?' ▲':' ▼'}
          </button>
        </div>

        {showFeeCfg && (
          <div style={{background:C.cream,borderRadius:10,padding:'10px 12px',marginBottom:12}}>
            {['Shopee SG','Shopee MY','Lazada SG','Lazada MY'].map(plat=>{
              const r = feeRules[plat]||DEFAULT_RULE
              return (
                <div key={plat} style={{marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.navy,marginBottom:4}}>{plat}</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
                    <div>
                      <label style={{fontSize:9,color:C.slate}}>佣金 %</label>
                      <input type="number" style={{...S.inp,padding:'6px 8px',fontSize:12}}
                        value={r.commission_pct??0}
                        onChange={e=>saveFeeRule(plat,{commission_pct:e.target.value})}/>
                    </div>
                    <div>
                      <label style={{fontSize:9,color:C.slate}}>支付手续费 %</label>
                      <input type="number" style={{...S.inp,padding:'6px 8px',fontSize:12}}
                        value={r.payment_fee_pct??0}
                        onChange={e=>saveFeeRule(plat,{payment_fee_pct:e.target.value})}/>
                    </div>
                    <div>
                      <label style={{fontSize:9,color:C.slate}}>固定运费/单</label>
                      <input type="number" style={{...S.inp,padding:'6px 8px',fontSize:12}}
                        value={r.fixed_shipping_fee??0}
                        onChange={e=>saveFeeRule(plat,{fixed_shipping_fee:e.target.value})}/>
                    </div>
                  </div>
                </div>
              )
            })}
            <button onClick={handleSaveAllFees} disabled={savingFee}
              style={{...S.btn(C.green,true,true),opacity:savingFee?0.6:1}}>
              {savingFee?'保存中…':'💾 保存费率'}
            </button>
          </div>
        )}

        {['SGD','RM'].map(cur=>{
          const s = profitStats[cur]
          if (!s.revenue && !s.cogs) return null
          const gross = s.revenue - s.cogs
          const net   = gross - s.fees
          return (
            <div key={cur} style={{marginBottom:12,padding:'10px 12px',
                background:cur==='SGD'?C.blue+'10':C.green+'10',borderRadius:10}}>
              <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>{cur} 平台</div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                <span style={{color:C.slate}}>销售额</span><span style={{fontWeight:700}}>{cur} {s.revenue.toFixed(2)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                <span style={{color:C.slate}}>商品成本</span><span>− {cur} {s.cogs.toFixed(2)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3,
                          borderTop:`1px solid ${C.slateLight}30`,paddingTop:3}}>
                <span style={{color:C.slate}}>毛利润</span><span style={{fontWeight:700}}>{cur} {gross.toFixed(2)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                <span style={{color:C.slate}}>平台费用（佣金/手续费/运费）</span><span>− {cur} {s.fees.toFixed(2)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:15,fontWeight:900,
                          borderTop:`1.5px solid ${C.navy}30`,paddingTop:5,marginTop:2}}>
                <span>净利润</span><span style={{color:net>=0?C.green:C.red}}>{cur} {net.toFixed(2)}</span>
              </div>
              {s.unmatchedItems>0&&(
                <div style={{fontSize:10,color:C.yellow,marginTop:6}}>
                  ⚠ {s.unmatchedItems} 笔订单明细没匹配到产品，没算进成本，净利润可能偏高
                </div>
              )}
            </div>
          )
        })}
        {!profitStats.SGD.revenue && !profitStats.RM.revenue && (
          <div style={{fontSize:12,color:C.slate,textAlign:'center',padding:'12px 0'}}>
            这段时间内没有符合筛选条件的订单销售数据
          </div>
        )}
      </div>

      {/* Product breakdown */}
      <div style={S.card}>
        <div style={{...S.secTitle,marginBottom:10}}>
          库存明细 · {platFilter} · 排序：{sortBy==='value'?'价值':sortBy==='stock'?'数量':'效期风险'}
        </div>

        {productStats.slice(0,20).map((p,i)=>{
          const pct = (p.value/maxVal)*100
          const barColor = p.expiryRisk>0 ? C.yellow : p.cur==='SGD' ? C.blue : C.green
          return (
            <div key={p.id} style={{paddingBottom:12,marginBottom:12,
                borderBottom:i<productStats.length-1?`1px solid ${C.cream}`:'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                <div style={{display:'flex',gap:8,alignItems:'center',flex:1,minWidth:0}}>
                  {p.photo_url&&<img src={p.photo_url} onError={e=>e.target.style.display='none'}
                    style={{width:28,height:28,borderRadius:5,objectFit:'cover',flexShrink:0}} alt=""/>}
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {p.name} {p.variant_name||''}
                    </div>
                    <div style={{fontSize:10,color:C.slate}}>
                      {p.stock}件 × {p.cur} {(p.cost||0).toFixed(2)}
                      <span style={{marginLeft:6,color:p.cur==='SGD'?C.blue:C.green,fontWeight:600}}>{p.cur}</span>
                    </div>
                  </div>
                </div>
                <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
                  <div style={{fontSize:13,fontWeight:800}}>{p.cur} {p.value.toFixed(2)}</div>
                  {p.expiryRisk>0&&(
                    <div style={{fontSize:10,color:C.yellow}}>⚠ {p.cur} {p.expiryRisk.toFixed(0)} 风险</div>
                  )}
                </div>
              </div>
              <div style={{height:5,background:C.cream,borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${pct}%`,background:barColor,borderRadius:3}}/>
              </div>
            </div>
          )
        })}

        {productStats.length>20&&(
          <div style={{textAlign:'center',fontSize:12,color:C.slate,padding:'8px'}}>
            还有 {productStats.length-20} 个产品未显示 · 使用上方筛选缩小范围
          </div>
        )}

        {/* Totals */}
        <div style={{borderTop:`2px solid ${C.cream}`,paddingTop:12,marginTop:4}}>
          {sgdValue>0&&(
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:12,color:C.slate}}>Shopee SG 库存总值</span>
              <span style={{fontWeight:800,color:C.blue}}>SGD {sgdValue.toFixed(2)}</span>
            </div>
          )}
          {myrValue>0&&(
            <div style={{display:'flex',justifyContent:'space-between'}}>
              <span style={{fontSize:12,color:C.slate}}>Shopee/Lazada MY 库存总值</span>
              <span style={{fontWeight:800,color:C.green}}>RM {myrValue.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
