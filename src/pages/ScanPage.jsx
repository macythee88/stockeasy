// src/pages/ScanPage.jsx
// 扫码方式：
// 1. 手机相机 — 用浏览器原生 BarcodeDetector API（iOS17+/Android Chrome）
//              或 getUserMedia + canvas fallback
// 2. 蓝牙扫码枪接手机 — 点输入框后扫
// 3. USB扫码枪接电脑 — 全局键盘监听，自动检测

import { useState, useRef, useEffect, useCallback } from 'react'
import { C, S } from '../App'

const daysUntil  = d => d ? Math.ceil((new Date(d) - new Date()) / 864e5) : null
const expiryColor = days => days===null?C.slate:days<=0?C.red:days<=14?C.red:days<=30?C.yellow:C.green

function ProductPhoto({ url, size=72, radius=12 }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) return (
    <div style={{ width:size, height:size, borderRadius:radius, background:C.cream, flexShrink:0,
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  border:`1px dashed ${broken?C.yellow:C.slateLight}50` }}>
      {broken
        ? <><span style={{fontSize:16}}>⚠️</span><span style={{fontSize:9,color:C.yellow}}>图片失效</span></>
        : <span style={{fontSize:26}}>📦</span>}
    </div>
  )
  return <img src={url} onError={()=>setBroken(true)}
    style={{width:size,height:size,borderRadius:radius,objectFit:'cover',flexShrink:0}} alt=""/>
}

export default function ScanPage({ products, batches, totalStock, productBatches,
                                   findProduct, addBatch, updateBatch, deleteBatch,
                                   stockOut, shout }) {
  // ── UI state
  const [query,     setQuery]     = useState('')
  const [scanView,  setScanView]  = useState(null)
  const [action,    setAction]    = useState(null)
  const [editBatch, setEditBatch] = useState(null)
  const [outQty,    setOutQty]    = useState(1)
  const [batchForm, setBatchForm] = useState({})
  const inputRef = useRef()

  // ── Camera state
  const [camMode,    setCamMode]    = useState(false)
  const [camError,   setCamError]   = useState(null)
  const [camLoading, setCamLoading] = useState(false)
  const [torchOn,    setTorchOn]    = useState(false)
  const [camSupport, setCamSupport] = useState(null) // 'detector'|'canvas'|'none'
  const videoRef    = useRef()
  const canvasRef   = useRef()
  const streamRef   = useRef(null)
  const detectorRef = useRef(null)
  const rafRef      = useRef(null)
  const scanningRef = useRef(false)

  const todayStr = new Date().toISOString().split('T')[0]
  const genBatchNo = () => {
    const d=new Date()
    return `LOT-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*999).toString().padStart(3,'0')}`
  }

  // ── USB/BT scanner: global keydown buffer ─────────────────
  const buf   = useRef('')
  const timer = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      const active = document.activeElement
      const inInput = active?.tagName==='INPUT'||active?.tagName==='TEXTAREA'
      if (e.key === 'Enter') {
        const code = buf.current.trim()
        if (code.length >= 4 && !inInput) doLookup(code)
        buf.current = ''
        clearTimeout(timer.current)
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        buf.current += e.key
        clearTimeout(timer.current)
        // Scanner sends chars < 50ms apart; human > 150ms
        timer.current = setTimeout(() => { buf.current = '' }, 80)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer.current) }
  }, [])

  // ── Detect camera support ─────────────────────────────────
  useEffect(() => {
    if ('BarcodeDetector' in window) {
      BarcodeDetector.getSupportedFormats().then(fmts => {
        if (fmts.length > 0) setCamSupport('detector')
        else setCamSupport('canvas')
      }).catch(() => setCamSupport('canvas'))
    } else {
      // Fallback: we'll still try getUserMedia + manual decode hint
      setCamSupport(navigator.mediaDevices ? 'canvas' : 'none')
    }
  }, [])

  // ── Start camera ──────────────────────────────────────────
  const startCamera = async () => {
    setCamLoading(true); setCamError(null)
    try {
      // Request rear camera
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamMode(true)

      // Start scanning loop
      scanningRef.current = true
      if (camSupport === 'detector' || 'BarcodeDetector' in window) {
        detectorRef.current = new BarcodeDetector({
          formats: ['ean_13','ean_8','code_128','code_39','qr_code','upc_a','upc_e','itf','codabar']
        })
        scanLoop()
      } else {
        // canvas fallback: no auto-decode, just show camera, user types
        setCamError(null)
      }
    } catch (e) {
      const msg =
        e.name==='NotAllowedError'  ? '请允许摄像头权限\n浏览器地址栏 → 🔒 → 摄像头 → 允许，然后重新整页' :
        e.name==='NotFoundError'    ? '找不到摄像头，请检查设备' :
        e.name==='NotReadableError' ? '摄像头被其他应用占用，请关闭后重试' :
        `摄像头错误：${e.message}`
      setCamError(msg)
    }
    setCamLoading(false)
  }

  // ── Scan loop (BarcodeDetector) ───────────────────────────
  const scanLoop = useCallback(() => {
    if (!scanningRef.current) return
    const video    = videoRef.current
    const detector = detectorRef.current
    if (!video || !detector || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(scanLoop)
      return
    }
    detector.detect(video).then(codes => {
      if (codes.length > 0 && scanningRef.current) {
        const code = codes[0].rawValue
        scanningRef.current = false  // stop scanning
        stopCamera()
        doLookup(code)
      } else {
        rafRef.current = requestAnimationFrame(scanLoop)
      }
    }).catch(() => {
      rafRef.current = requestAnimationFrame(scanLoop)
    })
  }, [])

  // ── Stop camera ───────────────────────────────────────────
  const stopCamera = useCallback(() => {
    scanningRef.current = false
    cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setCamMode(false); setTorchOn(false); setCamError(null)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  // ── Torch ─────────────────────────────────────────────────
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] })
      setTorchOn(t => !t)
    } catch { shout('此设备不支持闪光灯', true) }
  }

  // ── Lookup ────────────────────────────────────────────────
  const doLookup = (q = query) => {
    const bc = (typeof q==='string' ? q : query).trim()
    if (!bc) return
    const p = findProduct(bc)
    if (!p) { setScanView({ error: `找不到：${bc}` }); setAction(null); return }
    setScanView({ product: p })
    setAction(null); setEditBatch(null)
    setBatchForm({ batch_no:genBatchNo(), qty:'', received_date:todayStr, expiry_date:'', cost:String(p.cost||'') })
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // ── Stock IN ──────────────────────────────────────────────
  const handleStockIn = async () => {
    const qty = parseInt(batchForm.qty)||0
    if (qty<=0) { shout('请输入有效数量',true); return }
    const p = scanView.product
    try {
      if (editBatch) {
        await updateBatch({ ...editBatch, qty, batch_no:batchForm.batch_no,
          received_date:batchForm.received_date, expiry_date:batchForm.expiry_date||null,
          cost:parseFloat(batchForm.cost)||p.cost })
        shout('批次已更新 ✓')
      } else {
        await addBatch({ id:crypto.randomUUID(), product_id:p.id,
          batch_no:batchForm.batch_no||genBatchNo(), qty,
          received_date:batchForm.received_date||todayStr,
          expiry_date:batchForm.expiry_date||null,
          cost:parseFloat(batchForm.cost)||p.cost })
        shout(`${p.name} 入库 ${qty} 件 ✓`)
      }
      setAction(null); setEditBatch(null)
      setScanView(v=>({...v}))
    } catch(e) { shout('操作失败：'+(e.message||''),true) }
  }

  // ── Stock OUT ─────────────────────────────────────────────
  const handleStockOut = async () => {
    const qty = parseInt(outQty)||0
    if (qty<=0) { shout('请输入数量',true); return }
    const total = totalStock(scanView.product.id)
    if (qty>total) { shout(`库存不足，现有 ${total} 件`,true); return }
    try {
      await stockOut(scanView.product.id, qty)
      shout(`出库 ${qty} 件（FEFO）✓`)
      setAction(null); setScanView(v=>({...v}))
    } catch(e) { shout('出库失败',true) }
  }

  const p    = scanView?.product
  const pBat = p ? productBatches(p.id) : []
  const stock = p ? totalStock(p.id) : 0

  return (
    <div>
      {/* ── Input / Camera ───────────────────────────────── */}
      <div style={S.card}>
        <div style={S.secTitle}>🔍 扫码查询</div>

        {/* Mode toggle */}
        <div style={{display:'flex',borderRadius:8,overflow:'hidden',
                     border:`1.5px solid ${C.slateLight}40`,marginBottom:10}}>
          <button onClick={stopCamera}
            style={{flex:1,padding:'9px',border:'none',fontSize:12,fontWeight:700,cursor:'pointer',
                   background:!camMode?C.orange:'#fff', color:!camMode?'#fff':C.slate}}>
            ⌨️ 手动 / 扫码枪
          </button>
          <button onClick={()=>{ if(!camMode) startCamera() }}
            style={{flex:1,padding:'9px',border:'none',fontSize:12,fontWeight:700,cursor:'pointer',
                   background:camMode?C.orange:'#fff', color:camMode?'#fff':C.slate}}>
            📷 相机扫码
          </button>
        </div>

        {/* Manual input */}
        {!camMode && (
          <>
            <div style={{display:'flex',gap:8}}>
              <input ref={inputRef} style={{...S.inp,flex:1}}
                placeholder="扫描 / 输入条码、SKU 或产品名… Enter"
                value={query} onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&doLookup()} autoFocus/>
              <button onClick={()=>doLookup()}
                style={{...S.btn(C.orange,false),padding:'11px 14px'}}>查询</button>
            </div>
            <div style={{fontSize:10,color:C.slateLight,marginTop:6,lineHeight:1.6}}>
              ⌨️ 手动输入按 Enter · 📡 蓝牙扫码枪：点输入框后扫 · 🔌 USB扫码枪：直接扫（自动检测）
            </div>
          </>
        )}

        {/* Camera loading */}
        {camLoading && (
          <div style={{textAlign:'center',padding:'24px',color:C.slate}}>
            <div style={{fontSize:28,marginBottom:6}}>📷</div>
            <div style={{fontSize:12}}>启动摄像头中…</div>
          </div>
        )}

        {/* Camera view */}
        {camMode && !camLoading && (
          <div style={{position:'relative',borderRadius:12,overflow:'hidden',
                       background:'#000',aspectRatio:'4/3'}}>
            <video ref={videoRef} playsInline muted autoPlay
              style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>

            {/* Scan overlay */}
            <div style={{position:'absolute',inset:0,display:'flex',
                         alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
              <div style={{width:'62%',aspectRatio:'1.6',position:'relative',
                           border:`2px solid ${C.orange}80`,borderRadius:8}}>
                {/* Animated scan line */}
                <div style={{position:'absolute',left:0,right:0,height:2,
                             background:`linear-gradient(90deg,transparent,${C.orange},transparent)`,
                             animation:'scan 1.8s ease-in-out infinite'}}/>
                {/* Corners */}
                {[['0','0'],['0','auto'],['auto','0'],['auto','auto']].map(([t,b],i)=>(
                  <div key={i} style={{position:'absolute',
                    top:t==='0'?-2:'auto', bottom:b==='0'?-2:'auto',
                    left:i<2?-2:'auto',    right:i>=2?-2:'auto',
                    width:16,height:16,
                    borderTop:   (t==='0')    ?`3px solid ${C.orange}`:'none',
                    borderBottom:(b==='0')    ?`3px solid ${C.orange}`:'none',
                    borderLeft:  (i<2)        ?`3px solid ${C.orange}`:'none',
                    borderRight: (i>=2)       ?`3px solid ${C.orange}`:'none',
                  }}/>
                ))}
              </div>
            </div>

            {/* Controls */}
            <div style={{position:'absolute',bottom:12,left:0,right:0,
                         display:'flex',justifyContent:'center',gap:10}}>
              <button onClick={toggleTorch}
                style={{background:torchOn?C.yellow:'rgba(0,0,0,0.6)',color:'#fff',
                       border:'none',borderRadius:20,padding:'7px 16px',fontSize:12,cursor:'pointer'}}>
                🔦 {torchOn?'关':'开'}闪光
              </button>
              <button onClick={stopCamera}
                style={{background:'rgba(231,76,60,0.85)',color:'#fff',
                       border:'none',borderRadius:20,padding:'7px 16px',fontSize:12,cursor:'pointer'}}>
                ✕ 关闭
              </button>
            </div>

            {/* iOS hint */}
            {camSupport==='canvas'&&(
              <div style={{position:'absolute',top:10,left:0,right:0,textAlign:'center'}}>
                <span style={{background:'rgba(0,0,0,0.6)',color:'#fff',fontSize:11,
                             borderRadius:20,padding:'4px 12px'}}>
                  对准条码后手动输入下方框
                </span>
              </div>
            )}
          </div>
        )}

        {/* If canvas mode: show input below camera */}
        {camMode && camSupport==='canvas' && (
          <div style={{marginTop:10,display:'flex',gap:8}}>
            <input style={{...S.inp,flex:1}} placeholder="对准条码后手动输入…"
              value={query} onChange={e=>setQuery(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&doLookup()} autoFocus/>
            <button onClick={()=>doLookup()}
              style={{...S.btn(C.orange,false),padding:'11px 14px'}}>查询</button>
          </div>
        )}

        {/* Camera error */}
        {camError && (
          <div style={{background:C.red+'12',border:`1px solid ${C.red}30`,
                       borderRadius:8,padding:'12px',marginTop:8}}>
            <div style={{fontSize:12,color:C.red,fontWeight:700,marginBottom:6}}>⚠ 摄像头无法启动</div>
            <div style={{fontSize:11,color:C.navy,lineHeight:1.7,whiteSpace:'pre-line'}}>{camError}</div>
            <div style={{display:'flex',gap:8,marginTop:10}}>
              <button onClick={startCamera} style={S.btn(C.orange,true,true)}>🔄 重试</button>
              <button onClick={()=>{stopCamera();setCamError(null)}}
                style={S.btn(C.slate,true,true)}>使用手动输入</button>
            </div>
          </div>
        )}

        {/* Compatibility note */}
        {!camMode && camSupport && (
          <div style={{fontSize:10,color:C.slateLight,marginTop:6,padding:'6px 8px',
                       background:C.cream,borderRadius:6}}>
            {camSupport==='detector'
              ? '✅ 您的浏览器支持自动条码识别'
              : camSupport==='canvas'
              ? '⚠️ 您的浏览器不支持自动识别（iOS需Safari 17+），相机可辅助手动输入'
              : '❌ 浏览器不支持相机，请使用扫码枪'}
          </div>
        )}
      </div>

      {/* Scan line CSS */}
      <style>{`
        @keyframes scan {
          0%   { top:5% }
          50%  { top:90% }
          100% { top:5% }
        }
      `}</style>

      {/* ── Quick pick ───────────────────────────────────── */}
      <div style={{...S.card,background:C.navyLight}}>
        <div style={{fontSize:11,color:C.slateLight,marginBottom:8,fontWeight:700}}>
          📋 快速选择（点击）
        </div>
        {products.slice(0,8).map(prod=>(
          <div key={prod.id} onClick={()=>doLookup(prod.barcode||prod.sku)}
            style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',
                   borderBottom:`1px solid #ffffff10`,cursor:'pointer'}}>
            {prod.photo_url&&(
              <img src={prod.photo_url} onError={e=>e.target.style.display='none'}
                style={{width:26,height:26,borderRadius:5,objectFit:'cover'}} alt=""/>
            )}
            <div style={{flex:1,fontSize:12,color:'#F7F5F0',overflow:'hidden',
                         textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {prod.name}{prod.variant_name&&` · ${prod.variant_name}`}
            </div>
            <div style={{fontSize:12,color:C.orange,fontWeight:700,flexShrink:0}}>
              {totalStock(prod.id)}件
            </div>
          </div>
        ))}
      </div>

      {/* ── Error ────────────────────────────────────────── */}
      {scanView?.error&&(
        <div style={{...S.card,border:`2px solid ${C.red}`}}>
          <div style={{color:C.red,fontWeight:700}}>❌ {scanView.error}</div>
          <div style={{fontSize:11,color:C.slate,marginTop:4}}>
            请检查条码是否已在产品库，或到产品页新增
          </div>
        </div>
      )}

      {/* ── Product view ─────────────────────────────────── */}
      {p&&(
        <div>
          <div style={{...S.card,border:`2px solid ${C.orange}33`}}>
            <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:12}}>
              <ProductPhoto url={p.photo_url} size={72} radius={12}/>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:16,lineHeight:1.3}}>{p.name}</div>
                {p.variant_name&&<div style={{fontSize:13,color:C.orange,fontWeight:600}}>{p.variant_name}</div>}
                <div style={{fontSize:10,color:C.slateLight,fontFamily:'monospace',marginTop:2}}>
                  {p.sku} · {p.barcode||'无条码'}
                </div>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
              {[['总库存',`${stock}件`,stock<p.min_stock?C.red:C.navy],
                ['成本',`RM ${(p.cost||0).toFixed(2)}`,C.navy],
                ['批次',`${pBat.length}批`,C.slate]].map(([l,v,col])=>(
                <div key={l} style={{textAlign:'center',background:C.cream,borderRadius:8,padding:'7px 4px'}}>
                  <div style={{fontSize:14,fontWeight:800,color:col}}>{v}</div>
                  <div style={{fontSize:10,color:C.slate}}>{l}</div>
                </div>
              ))}
            </div>
            {!action&&(
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>{setAction('in');setEditBatch(null);
                  setBatchForm({batch_no:genBatchNo(),qty:'',received_date:todayStr,expiry_date:'',cost:String(p.cost||'')})}}
                  style={S.btn(C.green,true,true)}>📦 入库</button>
                <button onClick={()=>{setAction('out');setOutQty(1)}}
                  style={S.btn(C.red,true,true)}>📤 出库</button>
              </div>
            )}
          </div>

          {/* Batch list */}
          <div style={S.card}>
            <div style={S.secTitle}>批次明细（FEFO 顺序）</div>
            {pBat.length===0&&(
              <div style={{fontSize:13,color:C.slateLight,textAlign:'center',padding:'12px'}}>
                暂无批次，点"入库"添加
              </div>
            )}
            {pBat.map((b,i)=>{
              const days=b.expiry_date?daysUntil(b.expiry_date):null
              const col=expiryColor(days)
              return(
                <div key={b.id} style={{padding:'10px',borderRadius:10,marginBottom:8,
                    background:days!==null&&days<=30?col+'12':C.cream,
                    border:days!==null&&days<=30?`1px solid ${col}30`:'none'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <div>
                      <span style={{fontSize:12,fontWeight:700}}>{b.batch_no}</span>
                      {i===0&&pBat.some(x=>x.expiry_date)&&(
                        <span style={{...S.tag(C.orange),marginLeft:6}}>先出</span>
                      )}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:16,fontWeight:900}}>
                        {b.qty}<span style={{fontSize:10,fontWeight:400,color:C.slate}}> 件</span>
                      </span>
                      <button onClick={()=>{
                        setEditBatch(b)
                        setBatchForm({batch_no:b.batch_no,qty:String(b.qty),
                          received_date:b.received_date,expiry_date:b.expiry_date||'',
                          cost:String(b.cost||p.cost)})
                        setAction('in')
                      }} style={{background:'none',border:`1px solid ${C.slate}`,borderRadius:5,
                                 padding:'3px 7px',fontSize:10,cursor:'pointer',color:C.slate}}>
                        编辑
                      </button>
                      <button onClick={async()=>{
                        if(!confirm('删除此批次？'))return
                        await deleteBatch(b.id); shout('批次已删除')
                      }} style={{background:'none',border:`1px solid ${C.red}`,borderRadius:5,
                                 padding:'3px 7px',fontSize:10,cursor:'pointer',color:C.red}}>
                        删
                      </button>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:C.slate}}>
                    入库：{b.received_date} · RM {(b.cost||0).toFixed(2)}/件
                  </div>
                  {b.expiry_date&&(
                    <div style={{fontSize:11,color:col,fontWeight:700,marginTop:3}}>
                      {days<=0?'⛔ 已过期':days<=14?`🔴 ${days}天到期`:days<=30?`🟡 ${days}天到期`:`✅ ${days}天到期`}
                      {' · '}{b.expiry_date}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Stock IN */}
          {action==='in'&&(
            <div style={{...S.card,border:`2px solid ${C.green}40`}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:12,color:C.green}}>
                {editBatch?'✏ 编辑批次':'📦 新增入库批次'}
              </div>
              {[['批次号','batch_no','text'],['入库数量 *','qty','number'],
                ['入库日期','received_date','date'],
                ...(p.has_expiry?[['有效日期','expiry_date','date']]:[]),
                ['成本 RM/件','cost','number']].map(([l,k,t])=>(
                <div key={k} style={{marginBottom:10}}>
                  <label style={S.lbl}>{l}</label>
                  <input type={t} style={S.inp} value={batchForm[k]||''}
                    onChange={e=>setBatchForm(f=>({...f,[k]:e.target.value}))}/>
                </div>
              ))}
              {p.has_expiry&&(
                <div style={{fontSize:11,color:C.purple,marginBottom:10,
                             padding:'7px 10px',background:C.purple+'12',borderRadius:8}}>
                  ⚠ 此产品启用效期管理，请填写有效日期
                </div>
              )}
              <div style={{display:'flex',gap:8}}>
                <button onClick={handleStockIn} style={S.btn(C.green)}>
                  ✓ {editBatch?'保存更改':'确认入库'}
                </button>
                <button onClick={()=>{setAction(null);setEditBatch(null)}}
                  style={S.btn(C.slate,false)}>取消</button>
              </div>
            </div>
          )}

          {/* Stock OUT */}
          {action==='out'&&(
            <div style={{...S.card,border:`2px solid ${C.red}40`}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:4,color:C.red}}>📤 出库</div>
              <div style={{fontSize:11,color:C.slate,marginBottom:12}}>FEFO 自动先出最早到期批次</div>
              <div style={{marginBottom:14}}>
                <label style={S.lbl}>出库数量（现有 {stock} 件）</label>
                <input type="number" min={1} max={stock} style={S.inp}
                  value={outQty} onChange={e=>setOutQty(parseInt(e.target.value)||1)}/>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={handleStockOut} style={S.btn(C.red)}>✓ 确认出库</button>
                <button onClick={()=>setAction(null)} style={S.btn(C.slate,false)}>取消</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
