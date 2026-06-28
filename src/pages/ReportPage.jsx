// src/pages/ReportPage.jsx
import { useState } from 'react'
import { C, S } from '../App'

export default function ReportPage({ products, batches, purchaseOrders, totalStock }) {
  const [period, setPeriod] = useState('30')

  // Cost of goods in stock
  const inventoryValue = products.reduce((s, p) => s + totalStock(p.id) * (p.cost || 0), 0)

  // Purchase history totals
  const allItems = purchaseOrders.flatMap(po => (po.po_items || []).map(i => ({ ...i, date: po.order_date })))
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - parseInt(period))
  const recentItems = allItems.filter(i => new Date(i.date) >= cutoff)
  const totalPurchased = recentItems.reduce((s, i) => s + i.qty * (i.cost || 0), 0)
  const totalUnits = recentItems.reduce((s, i) => s + i.qty, 0)

  // Expiry risk value
  const today = new Date()
  const expiryRisk = batches
    .filter(b => b.expiry_date && Math.ceil((new Date(b.expiry_date) - today) / 864e5) <= 30 && b.qty > 0)
    .reduce((s, b) => {
      const p = products.find(x => x.id === b.product_id)
      return s + b.qty * (p?.cost || 0)
    }, 0)

  // Per-product breakdown
  const productStats = products.map(p => {
    const stock = totalStock(p.id)
    const value = stock * (p.cost || 0)
    const pBatches = batches.filter(b => b.product_id === p.id)
    const nearExpiry = pBatches.filter(b => b.expiry_date && Math.ceil((new Date(b.expiry_date) - today) / 864e5) <= 30)
    return { ...p, stock, value, nearExpiry }
  }).sort((a, b) => b.value - a.value)

  return (
    <div>
      {/* Period selector */}
      <div style={{ display:'flex', borderRadius:8, overflow:'hidden', border:`1.5px solid ${C.slateLight}40`, marginBottom:14 }}>
        {[['7','7天'],['30','30天'],['90','90天'],['365','全年']].map(([v, l]) => (
          <button key={v} onClick={() => setPeriod(v)} style={S.seg(period === v)}>{l}</button>
        ))}
      </div>

      {/* Summary stats */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
        {[
          [`RM ${inventoryValue.toFixed(0)}`, '库存总价值', C.blue],
          [`RM ${totalPurchased.toFixed(0)}`, `${period}天入货`, C.navy],
          [`${totalUnits}件`, `${period}天入库`, C.navy],
          [`RM ${expiryRisk.toFixed(0)}`, '效期风险值', expiryRisk > 0 ? C.red : C.navyMid],
        ].map(([v, l, col]) => (
          <div key={l} style={{ background:C.navy, borderRadius:12, padding:'14px 16px' }}>
            <div style={{ fontSize:22, fontWeight:900, color:col, lineHeight:1 }}>{v}</div>
            <div style={{ fontSize:11, color:C.slateLight, marginTop:4 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Inventory breakdown */}
      <div style={S.card}>
        <div style={S.secTitle}>库存价值明细</div>
        {productStats.filter(p => p.stock > 0).map((p, i, arr) => {
          const pct = inventoryValue > 0 ? (p.value / inventoryValue) * 100 : 0
          return (
            <div key={p.id} style={{ paddingBottom:12, marginBottom:12, borderBottom: i < arr.length - 1 ? `1px solid ${C.cream}` : 'none' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  {p.photo_url && <img src={p.photo_url} style={{ width:28, height:28, borderRadius:5, objectFit:'cover' }} alt="" />}
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.name} <span style={{ color:C.orange }}>{p.variant_name}</span></div>
                    <div style={{ fontSize:10, color:C.slate }}>{p.stock}件 × RM{p.cost}</div>
                  </div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:13, fontWeight:800 }}>RM {p.value.toFixed(2)}</div>
                  <div style={{ fontSize:10, color:C.slate }}>{pct.toFixed(1)}%</div>
                </div>
              </div>
              <div style={{ height:6, background:C.cream, borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${pct}%`, background: p.nearExpiry.length > 0 ? C.yellow : C.blue, borderRadius:3 }} />
              </div>
              {p.nearExpiry.length > 0 && (
                <div style={{ fontSize:10, color:C.yellow, marginTop:3 }}>
                  ⚠ {p.nearExpiry.reduce((s, b) => s + b.qty, 0)}件将于30天内到期
                </div>
              )}
            </div>
          )
        })}
        <div style={{ borderTop:`2px solid ${C.cream}`, paddingTop:10, display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontWeight:700 }}>总库存价值</span>
          <span style={{ fontWeight:900, fontSize:16, color:C.navy }}>RM {inventoryValue.toFixed(2)}</span>
        </div>
      </div>

      {/* Recent purchases */}
      {recentItems.length > 0 && (
        <div style={S.card}>
          <div style={S.secTitle}>最近 {period} 天入货记录</div>
          {purchaseOrders
            .filter(po => new Date(po.order_date) >= cutoff)
            .slice(0, 5)
            .map((po, i, arr) => {
              const poItems = po.po_items || []
              const total = poItems.reduce((s, i) => s + i.qty * (i.cost || 0), 0)
              return (
                <div key={po.id} style={{ display:'flex', justifyContent:'space-between', paddingBottom:8, marginBottom:8, borderBottom: i < arr.length - 1 ? `1px solid ${C.cream}` : 'none' }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:600 }}>{po.po_number}</div>
                    <div style={{ fontSize:11, color:C.slate }}>{po.order_date} · {poItems.length} 种产品</div>
                  </div>
                  <div style={{ fontSize:13, fontWeight:700 }}>RM {total.toFixed(2)}</div>
                </div>
              )
            })}
        </div>
      )}

      {/* Note about future Shopee import */}
      <div style={{ ...S.card, background:C.navyLight }}>
        <div style={{ color:C.orange, fontWeight:700, fontSize:12, marginBottom:6 }}>💡 盈利计算（即将推出）</div>
        <div style={{ color:C.slateLight, fontSize:11, lineHeight:1.7 }}>
          导入 Shopee / Lazada 订单 Excel 后，系统将自动计算：{'\n'}
          • 每单毛利润 = 售价 − 成本 − 运费{'\n'}
          • 净利润 = 毛利润 − 平台佣金（Shopee 6% / Lazada 5%）{'\n'}
          • 月度盈利趋势图
        </div>
      </div>
    </div>
  )
}
