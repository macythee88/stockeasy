// src/pages/Dashboard.jsx
import { C, S, StatusBadge } from '../App'

const daysUntil = d => d ? Math.ceil((new Date(d) - new Date()) / 864e5) : null
const expColor  = d => d <= 0 ? C.red : d <= 14 ? C.red : d <= 30 ? C.yellow : C.green

export default function Dashboard({ products, batches, suppliers, purchaseOrders,
                                    expiryAlerts, totalStock, setTab, shout }) {
  const lowStock = products.filter(p => totalStock(p.id) < p.min_stock)
  const totalValue = products.reduce((s, p) => s + totalStock(p.id) * (p.cost || 0), 0)

  return (
    <div>
      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
        {[
          [products.length, '产品 SKU', C.navy],
          [`RM ${totalValue.toFixed(0)}`, '库存价值', C.navy],
          [lowStock.length, '需补货', lowStock.length > 0 ? C.red : C.navyMid],
          [expiryAlerts.length, '效期预警', expiryAlerts.length > 0 ? C.purple : C.navyMid],
        ].map(([v, l, bg]) => (
          <div key={l} style={{ background:bg, borderRadius:12, padding:'14px 16px' }}>
            <div style={{ fontSize:26, fontWeight:900, color:C.orange, lineHeight:1 }}>{v}</div>
            <div style={{ fontSize:11, color:C.slateLight, marginTop:4 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Low stock */}
      {lowStock.length > 0 && (
        <div style={{ ...S.card, border:`1px solid ${C.red}30` }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.red, marginBottom:8 }}>⚠ 需补货</div>
          {lowStock.slice(0, 4).map((p, i) => {
            const stock = totalStock(p.id)
            const sup = suppliers.find(s => s.id === p.supplier_id)
            return (
              <div key={p.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                  paddingBottom:8, marginBottom:8, borderBottom: i < 3 ? `1px solid ${C.cream}` : 'none' }}>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  {p.photo_url && <img src={p.photo_url} style={{ width:30, height:30, borderRadius:6, objectFit:'cover' }} alt="" />}
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.name} {p.variant_name}</div>
                    {sup && <div style={{ fontSize:10, color:C.slate }}>{sup.name}</div>}
                  </div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:14, fontWeight:900, color:C.red }}>{stock} 件</div>
                  <div style={{ fontSize:10, color:C.slate }}>线 {p.min_stock}</div>
                </div>
              </div>
            )
          })}
          <button onClick={() => setTab('purchase')} style={S.btn(C.orange, true, true)}>📋 开入货单</button>
        </div>
      )}

      {/* Expiry alerts */}
      {expiryAlerts.length > 0 && (
        <div style={{ ...S.card, border:`1px solid ${C.purple}30` }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.purple, marginBottom:8 }}>⏰ 效期提醒</div>
          {expiryAlerts.slice(0, 3).map((b, i) => {
            const p = products.find(x => x.id === b.product_id)
            const days = daysUntil(b.expiry_date)
            return (
              <div key={b.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                  paddingBottom:8, marginBottom:8, borderBottom: i < 2 ? `1px solid ${C.cream}` : 'none' }}>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  {p?.photo_url && <img src={p.photo_url} style={{ width:30, height:30, borderRadius:6, objectFit:'cover' }} alt="" />}
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p?.name} {p?.variant_name}</div>
                    <div style={{ fontSize:10, color:C.slate }}>{b.batch_no} · {b.qty}件</div>
                  </div>
                </div>
                <div style={{ fontSize:12, fontWeight:900, color:expColor(days) }}>
                  {days <= 0 ? '已过期' : `${days}天`}
                </div>
              </div>
            )
          })}
          <a href={`https://wa.me/?text=${encodeURIComponent(
            `⏰ StockEasy 效期提醒\n${expiryAlerts.slice(0,5).map(b => {
              const p = products.find(x => x.id === b.product_id)
              const d = daysUntil(b.expiry_date)
              return `• ${p?.name} ${p?.variant_name} — ${d <= 0 ? '已过期' : `${d}天到期`} (${b.qty}件)`
            }).join('\n')}`
          )}`} target="_blank" rel="noreferrer"
            style={{ ...S.btn(C.green, true, true), display:'block', textDecoration:'none', textAlign:'center', marginTop:8 }}>
            📲 WhatsApp 发送提醒
          </a>
        </div>
      )}

      {/* Product list */}
      <div style={S.card}>
        <div style={S.secTitle}>库存总览</div>
        {products.slice(0, 8).map((p, i) => {
          const stock = totalStock(p.id)
          return (
            <div key={p.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                paddingBottom:10, marginBottom:10, borderBottom: i < products.length - 1 ? `1px solid ${C.cream}` : 'none' }}
              onClick={() => setTab('scan')}>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                {p.photo_url
                  ? <img src={p.photo_url} style={{ width:38, height:38, borderRadius:8, objectFit:'cover' }} alt="" />
                  : <div style={{ width:38, height:38, borderRadius:8, background:C.cream, display:'flex', alignItems:'center', justifyContent:'center' }}>📦</div>}
                <div>
                  <div style={{ fontSize:13, fontWeight:600 }}>{p.name}</div>
                  <div style={{ fontSize:10, color:C.slate }}>{p.variant_name}</div>
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:18, fontWeight:900, color: stock < p.min_stock ? C.red : C.navy }}>{stock}</div>
                <StatusBadge stock={stock} min={p.min_stock} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
