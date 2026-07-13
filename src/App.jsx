// src/App.jsx — with Orders tab added
import { useState } from 'react'
import { useData }   from './hooks/useData'
import { useOrders } from './hooks/useOrders'

export const C = {
  navy:'#0F1B2D', navyMid:'#1A2E48', navyLight:'#243B55',
  orange:'#FF6B35', cream:'#F7F5F0', slate:'#4A6080', slateLight:'#8FA3BC',
  green:'#2ECC71', red:'#E74C3C', yellow:'#F39C12', purple:'#9B59B6', blue:'#3498DB',
  teal:'#1ABC9C',
}

export const S = {
  inp: { width:'100%', padding:'11px 13px', borderRadius:8,
         border:'1.5px solid #8FA3BC50', fontSize:14, outline:'none',
         boxSizing:'border-box', background:'#fff', fontFamily:'inherit' },
  card: { background:'#fff', borderRadius:12, padding:'15px 16px', marginBottom:12,
          boxShadow:'0 1px 5px rgba(0,0,0,.07)' },
  lbl:  { fontSize:11, color:'#4A6080', display:'block', marginBottom:4, fontWeight:600 },
  btn:  (bg='#FF6B35', full=true, sm=false) => ({
    background:bg, color:'#fff', border:'none', borderRadius:8,
    padding: sm ? '7px 12px' : '12px 16px',
    fontWeight:700, fontSize: sm ? 11 : 14, cursor:'pointer',
    ...(full ? { width:'100%' } : {})
  }),
  seg: (active, col='#FF6B35') => ({
    flex:1, padding:'9px 4px', border:'none',
    background: active ? col : '#fff',
    color: active ? '#fff' : '#4A6080',
    fontWeight:700, fontSize:11, cursor:'pointer',
  }),
  tag: (col) => ({
    background: col+'18', color: col, border:`1px solid ${col}33`,
    borderRadius:6, padding:'2px 7px', fontSize:10, fontWeight:600,
    display:'inline-block', marginRight:4, marginTop:2,
  }),
  secTitle: { fontSize:12, fontWeight:700, color:'#4A6080', marginBottom:10,
              textTransform:'uppercase', letterSpacing:.8 },
}

export function Toast({ toast }) {
  if (!toast) return null
  return (
    <div style={{ position:'fixed', top:58, left:'50%', transform:'translateX(-50%)',
      zIndex:9999, background: toast.err ? C.red : C.green, color:'#fff',
      borderRadius:24, padding:'9px 20px', fontWeight:700, fontSize:13,
      boxShadow:'0 4px 20px rgba(0,0,0,.3)', maxWidth:'90vw', textAlign:'center' }}>
      {toast.msg}
    </div>
  )
}

export function StatusBadge({ stock, min }) {
  const st = stock <= 0 ? 'out' : stock < min ? 'low' : 'ok'
  const m  = { ok:[C.green,'充足'], low:[C.yellow,'需补货'], out:[C.red,'缺货'] }
  const [col, label] = m[st]
  return (
    <span style={{ background:col+'22', color:col, border:`1px solid ${col}55`,
      borderRadius:20, padding:'2px 9px', fontSize:11, fontWeight:700 }}>
      {label}
    </span>
  )
}

// ── Page imports ──────────────────────────────────────────────
import Dashboard    from './pages/Dashboard.jsx'
import ScanPage     from './pages/ScanPage.jsx'
import PurchasePage from './pages/PurchasePage.jsx'
import ReportPage   from './pages/ReportPage.jsx'
import ProductsPage from './pages/ProductsPage.jsx'
import ImportPage   from './pages/ImportPage.jsx'
import OrdersPage   from './pages/OrdersPage.jsx'

// ── Tabs ──────────────────────────────────────────────────────
const TABS = [
  { id:'dashboard', icon:'📊', label:'总览'  },
  { id:'orders',    icon:'📋', label:'订单'  },
  { id:'scan',      icon:'🔍', label:'扫码'  },
  { id:'purchase',  icon:'📦', label:'入货'  },
  { id:'products',  icon:'🗂',  label:'产品' },
  { id:'import',    icon:'📥', label:'导入'  },
]

export default function App() {
  const data   = useData()
  const orders = useOrders()
  const [tab,   setTab]   = useState('dashboard')
  const [toast, setToast] = useState(null)

  const shout = (msg, err=false) => {
    setToast({ msg, err })
    setTimeout(() => setToast(null), 3200)
  }

  const expiryAlerts = data.batches.filter(b => {
    if (!b.expiry_date) return false
    return Math.ceil((new Date(b.expiry_date) - new Date()) / 864e5) <= 30
  })
  const lowStockCount = data.products.filter(p => data.totalStock(p.id) < p.min_stock).length

  const pageProps = { ...data, shout, setTab }

  return (
    <div style={{ fontFamily:"'Inter',system-ui,sans-serif",
                  background:C.cream, minHeight:'100vh', color:C.navy }}>
      <Toast toast={toast} />

      {/* Offline banner */}
      {!data.online && (
        <div style={{ background:C.yellow, color:C.navy, padding:'6px 16px',
                      textAlign:'center', fontSize:12, fontWeight:700 }}>
          📡 离线模式 — 数据已保存，联网后自动同步
        </div>
      )}

      {/* Header */}
      <div style={{ background:C.navy, padding:'0 16px', display:'flex',
                    alignItems:'center', justifyContent:'space-between',
                    height:52, position:'sticky', top: data.online?0:28, zIndex:100 }}>
        <div>
          <span style={{ color:C.orange, fontWeight:900, fontSize:19 }}>StockEasy</span>
          <span style={{ color:C.slateLight, fontSize:11, marginLeft:8 }}>upin-global.com</span>
        </div>
        <div style={{ display:'flex', gap:5, alignItems:'center' }}>
          <div style={{ width:8, height:8, borderRadius:'50%',
                        background: data.online ? C.green : C.yellow }} />
          {orders.counts.unprocessed > 0 && (
            <div onClick={()=>setTab('orders')}
              style={{ background:C.red, color:'#fff', borderRadius:20,
                       padding:'2px 8px', fontSize:11, fontWeight:700, cursor:'pointer' }}>
              📋{orders.counts.unprocessed}
            </div>
          )}
          {expiryAlerts.length > 0 && (
            <div style={{ background:C.purple, color:'#fff', borderRadius:20,
                          padding:'2px 8px', fontSize:11, fontWeight:700 }}>
              ⏰{expiryAlerts.length}
            </div>
          )}
          {lowStockCount > 0 && (
            <div style={{ background:C.yellow, color:C.navy, borderRadius:20,
                          padding:'2px 8px', fontSize:11, fontWeight:700 }}>
              ⚠{lowStockCount}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:430, margin:'0 auto' }}>
        <div style={{ padding:'14px 14px 80px' }}>
          {data.loading
            ? <div style={{ textAlign:'center', padding:'60px 0', color:C.slate }}>
                <div style={{ fontSize:32, marginBottom:8 }}>⏳</div>
                <div style={{ fontSize:13 }}>连接数据库中…</div>
              </div>
            : <>
                {tab==='dashboard' && <Dashboard    {...pageProps} expiryAlerts={expiryAlerts} />}
                {tab==='orders'    && <OrdersPage   {...orders}    shout={shout} products={data.products} />}
                {tab==='scan'      && <ScanPage     {...pageProps} />}
                {tab==='purchase'  && <PurchasePage {...pageProps} />}
                {tab==='products'  && <ProductsPage {...pageProps} />}
                {tab==='import'    && <ImportPage   shout={shout}  refetch={data.refetch} />}
              </>}
        </div>

        {/* Bottom nav */}
        <div style={{ position:'fixed', bottom:0, left:'50%',
                      transform:'translateX(-50%)', width:'100%', maxWidth:430,
                      background:C.navy, display:'flex',
                      borderTop:`1px solid ${C.navyMid}` }}>
          {TABS.map(t => {
            const active = tab === t.id
            const badge  = t.id==='orders' && orders.counts.unprocessed > 0
                           ? orders.counts.unprocessed : null
            return (
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{ flex:1, padding:'8px 2px 6px', border:'none',
                         background: active ? C.navyLight : C.navy,
                         color:      active ? C.orange    : C.slateLight,
                         fontSize:8, fontWeight: active?700:400, cursor:'pointer',
                         borderTop: active ? `2px solid ${C.orange}` : '2px solid transparent',
                         position:'relative' }}>
                <div style={{ fontSize:15 }}>{t.icon}</div>
                <div style={{ marginTop:1 }}>{t.label}</div>
                {badge && (
                  <div style={{ position:'absolute', top:4, right:'20%',
                                background:C.red, color:'#fff', borderRadius:10,
                                padding:'1px 4px', fontSize:8, fontWeight:700 }}>
                    {badge}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
