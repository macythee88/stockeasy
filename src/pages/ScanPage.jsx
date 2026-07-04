// src/pages/ScanPage.jsx
// 支持三种扫码方式：
// 1. 手机相机（iOS Safari + Android Chrome）— 使用 ZXing
// 2. 蓝牙扫码枪接手机（模拟键盘输入，Enter触发）
// 3. USB扫码枪接电脑（同上，监听全局键盘）

import { useState, useRef, useEffect, useCallback } from 'react'
import { C, S } from '../App'

// ── ZXing 动态加载（只在需要时加载，不影响首页速度）
let ZXing = null
async function loadZXing() {
  if (ZXing) return ZXing
  const mod = await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm')
  ZXing = mod
  return ZXing
}

const daysUntil = d => d ? Math.ceil((new Date(d) - new Date()) / 864e5) : null
const expiryColor = days => {
  if (days === null) return C.slate
  if (days <= 0)  return C.red
  if (days <= 14) return C.red
  if (days <= 30) return C.yellow
  return C.green
}

function ProductPhoto({ url, size = 72, radius = 12 }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) return (
    <div style={{ width: size, height: size, borderRadius: radius, background: C.cream, flexShrink: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  border: `1px dashed ${broken ? C.yellow : C.slateLight}50` }}>
      {broken
        ? <><span style={{ fontSize: 18 }}>⚠️</span><span style={{ fontSize: 9, color: C.yellow }}>图片失效</span></>
        : <span style={{ fontSize: 28 }}>📦</span>}
    </div>
  )
  return <img src={url} onError={() => setBroken(true)}
    style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0 }} alt="" />
}

export default function ScanPage({ products, batches, totalStock, productBatches,
                                   findProduct, addBatch, updateBatch, deleteBatch,
                                   stockOut, shout }) {
  // ── Query / view state
  const [query,     setQuery]     = useState('')
  const [scanView,  setScanView]  = useState(null)
  const [action,    setAction]    = useState(null)   // 'in' | 'out'
  const [editBatch, setEditBatch] = useState(null)
  const [outQty,    setOutQty]    = useState(1)
  const [batchForm, setBatchForm] = useState({})
  const inputRef = useRef()

  // ── Camera scanner state
  const [camMode,    setCamMode]    = useState(false)
  const [camError,   setCamError]   = useState(null)
  const [camLoading, setCamLoading] = useState(false)
  const [torchOn,    setTorchOn]    = useState(false)
  const videoRef    = useRef()
  const readerRef   = useRef(null)
  const streamRef   = useRef(null)

  // ── USB / Bluetooth scanner: buffer rapid keystrokes ending with Enter
  const barcodeBuffer = useRef('')
  const barcodeTimer  = useRef(null)

  const todayStr = new Date().toISOString().split('T')[0]
  const genBatchNo = () => {
    const d = new Date()
    return `LOT-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*999).toString().padStart(3,'0')}`
  }

  // ── Global keyboard listener for USB/BT scanners ──────────
  // Scanners type very fast then send Enter — we detect this pattern
  useEffect(() => {
    const handleKey = (e) => {
      // Ignore if user is typing in an input (manual entry handled separately)
      const tag = document.activeElement?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === 'Enter') {
        const buf = barcodeBuffer.current.trim()
        if (buf.length >= 4 && !isInput) {
          // Scanned from scanner while no input focused — do lookup
          doLookup(buf)
        }
        barcodeBuffer.current = ''
        clearTimeout(barcodeTimer.current)
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        barcodeBuffer.current += e.key
        // Clear buffer if no new char within 100ms (human typing is slower)
        clearTimeout(barcodeTimer.current)
        barcodeTimer.current = setTimeout(() => {
          barcodeBuffer.current = ''
        }, 100)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      clearTimeout(barcodeTimer.current)
    }
  }, [])

  // ── Camera: start ─────────────────────────────────────────
  const startCamera = async () => {
    setCamLoading(true); setCamError(null)
    try {
      const zx = await loadZXing()
      const hints = new Map()
      hints.set(zx.DecodeHintType.TRY_HARDER, true)

      const reader = new zx.BrowserMultiFormatReader(hints)
      readerRef.current = reader

      // Prefer rear camera
      const devices = await zx.BrowserMultiFormatReader.listVideoInputDevices()
      const rear = devices.find(d =>
        d.label.toLowerCase().includes('back') ||
        d.label.toLowerCase().includes('rear') ||
        d.label.toLowerCase().includes('environment')
      ) || devices[devices.length - 1]

      await reader.decodeFromVideoDevice(
        rear?.deviceId || undefined,
        videoRef.current,
        (result, err) => {
          if (result) {
            const code = result.getText()
            stopCamera()
            doLookup(code)
          }
          // Ignore continuous decode errors (normal when no barcode in view)
        }
      )

      // Save stream ref for torch control
      if (videoRef.current?.srcObject) {
        streamRef.current = videoRef.current.srcObject
      }

      setCamMode(true)
    } catch (e) {
      setCamError(
        e.name === 'NotAllowedError'
          ? '请允许摄像头权限：浏览器地址栏旁边的 🔒 → 摄像头 → 允许'
          : e.name === 'NotFoundError'
          ? '找不到摄像头，请检查设备'
          : `摄像头错误：${e.message}`
      )
    }
    setCamLoading(false)
  }

  // ── Camera: stop ──────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.reset()
      readerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCamMode(false); setTorchOn(false)
  }, [])

  // Stop camera when leaving page
  useEffect(() => () => stopCamera(), [stopCamera])

  // ── Torch (flashlight) ─────────────────────────────────────
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] })
      setTorchOn(t => !t)
    } catch {
      shout('此设备不支持闪光灯', true)
    }
  }

  // ── Lookup product ────────────────────────────────────────
  const doLookup = (q = query) => {
    const bc = (q || '').trim()
    if (!bc) return
    const p = findProduct(bc)
    if (!p) {
      setScanView({ error: `找不到：${bc}` })
      setAction(null)
      return
    }
    setScanView({ product: p })
    setAction(null); setEditBatch(null)
    setBatchForm({
      batch_no:      genBatchNo(),
      qty:           '',
      received_date: todayStr,
      expiry_date:   '',
      cost:          String(p.cost || ''),
    })
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // ── Stock IN ──────────────────────────────────────────────
  const handleStockIn = async () => {
    const qty = parseInt(batchForm.qty) || 0
    if (qty <= 0) { shout('请输入有效数量', true); return }
    const p = scanView.product
    try {
      if (editBatch) {
        await updateBatch({
          ...editBatch, qty,
          batch_no:      batchForm.batch_no,
          received_date: batchForm.received_date,
          expiry_date:   batchForm.expiry_date || null,
          cost:          parseFloat(batchForm.cost) || p.cost,
        })
        shout('批次已更新 ✓')
      } else {
        await addBatch({
          id:            crypto.randomUUID(),
          product_id:    p.id,
          batch_no:      batchForm.batch_no || genBatchNo(),
          qty,
          received_date: batchForm.received_date || todayStr,
          expiry_date:   batchForm.expiry_date || null,
          cost:          parseFloat(batchForm.cost) || p.cost,
        })
        shout(`${p.name} 入库 ${qty} 件 ✓`)
      }
      setAction(null); setEditBatch(null)
      // Refresh view
      setScanView(v => ({ ...v }))
    } catch (e) { shout('操作失败：' + (e.message || ''), true) }
  }

  // ── Stock OUT ─────────────────────────────────────────────
  const handleStockOut = async () => {
    const qty = parseInt(outQty) || 0
    if (qty <= 0) { shout('请输入数量', true); return }
    const total = totalStock(scanView.product.id)
    if (qty > total) { shout(`库存不足，现有 ${total} 件`, true); return }
    try {
      await stockOut(scanView.product.id, qty)
      shout(`出库 ${qty} 件（FEFO）✓`)
      setAction(null)
      setScanView(v => ({ ...v }))
    } catch (e) { shout('出库失败', true) }
  }

  const p     = scanView?.product
  const pBat  = p ? productBatches(p.id) : []
  const stock = p ? totalStock(p.id) : 0

  // ── RENDER ────────────────────────────────────────────────
  return (
    <div>

      {/* ── Scanner mode bar ─────────────────────────────── */}
      <div style={{ ...S.card, padding: '12px 14px', marginBottom: 10 }}>
        <div style={S.secTitle}>扫码查询</div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden',
                      border: `1.5px solid ${C.slateLight}40`, marginBottom: 10 }}>
          {[
            { id: 'manual', icon: '⌨️', label: '手动输入' },
            { id: 'camera', icon: '📷', label: '相机扫码' },
          ].map(m => (
            <button key={m.id}
              onClick={() => {
                if (m.id === 'camera') { if (!camMode) startCamera() }
                else { stopCamera() }
              }}
              style={{ flex: 1, padding: '9px 4px', border: 'none', fontSize: 12, fontWeight: 700,
                       cursor: 'pointer',
                       background: (m.id === 'camera' ? camMode : !camMode) ? C.orange : '#fff',
                       color:      (m.id === 'camera' ? camMode : !camMode) ? '#fff'   : C.slate }}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>

        {/* Manual input (also catches USB/BT scanner input when focused) */}
        {!camMode && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={inputRef}
                style={{ ...S.inp, flex: 1 }}
                placeholder="扫描条码 / 输入 SKU 或产品名… (Enter)"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doLookup()}
                autoFocus
              />
              <button onClick={() => doLookup()}
                style={{ ...S.btn(C.orange, false), padding: '11px 14px' }}>查询</button>
            </div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 6 }}>
              ⌨️ 手动输入 · 🔌 USB扫码枪（自动检测） · 📡 蓝牙扫码枪（连手机后点此框再扫）
            </div>
          </>
        )}

        {/* Camera view */}
        {camMode && (
          <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden',
                        background: '#000', aspectRatio: '4/3' }}>
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              playsInline muted autoPlay />

            {/* Scanning overlay */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex',
                          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ width: '60%', aspectRatio: '1', position: 'relative' }}>
                {/* Corner markers */}
                {[['0','0','right','bottom'],['auto','0','left','bottom'],
                  ['0','auto','right','top'],['auto','auto','left','top']].map(([t,b,br,tl],i) => (
                  <div key={i} style={{
                    position: 'absolute', top: t==='0'?0:'auto', bottom: b==='0'?0:'auto',
                    left: tl==='left'?0:'auto', right: br==='right'?0:'auto',
                    width: 20, height: 20,
                    borderTop:    tl==='left'  ? `3px solid ${C.orange}` : 'none',
                    borderBottom: tl==='right' ? `3px solid ${C.orange}` : 'none',
                    borderLeft:   tl==='left'  ? `3px solid ${C.orange}` : 'none',
                    borderRight:  br==='right' ? `3px solid ${C.orange}` : 'none',
                  }}/>
                ))}
                {/* Scan line animation */}
                <div style={{
                  position: 'absolute', left: 4, right: 4, height: 2,
                  background: C.orange, opacity: 0.8,
                  animation: 'scanline 1.5s ease-in-out infinite',
                  top: '50%',
                }}/>
              </div>
            </div>

            {/* Camera controls */}
            <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0,
                          display: 'flex', justifyContent: 'center', gap: 10 }}>
              <button onClick={toggleTorch}
                style={{ background: torchOn ? C.yellow : 'rgba(0,0,0,0.5)',
                         color: '#fff', border: 'none', borderRadius: 20,
                         padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
                {torchOn ? '🔦 关闪光' : '🔦 开闪光'}
              </button>
              <button onClick={stopCamera}
                style={{ background: 'rgba(231,76,60,0.8)', color: '#fff',
                         border: 'none', borderRadius: 20,
                         padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
                ✕ 关闭
              </button>
            </div>
          </div>
        )}

        {camLoading && (
          <div style={{ textAlign: 'center', padding: '20px', color: C.slate }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>📷</div>
            <div style={{ fontSize: 12 }}>启动摄像头中…</div>
          </div>
        )}

        {camError && (
          <div style={{ background: C.red + '12', border: `1px solid ${C.red}30`,
                        borderRadius: 8, padding: '10px 12px', marginTop: 8 }}>
            <div style={{ fontSize: 12, color: C.red, fontWeight: 700, marginBottom: 4 }}>⚠ 摄像头错误</div>
            <div style={{ fontSize: 11, color: C.navy, lineHeight: 1.6 }}>{camError}</div>
            <button onClick={startCamera}
              style={{ ...S.btn(C.orange, true, true), marginTop: 8 }}>重试</button>
          </div>
        )}
      </div>

      {/* Scan line CSS animation */}
      <style>{`
        @keyframes scanline {
          0%   { top: 10%; }
          50%  { top: 90%; }
          100% { top: 10%; }
        }
      `}</style>

      {/* ── Quick pick ───────────────────────────────────── */}
      <div style={{ ...S.card, background: C.navyLight }}>
        <div style={{ fontSize: 11, color: C.slateLight, marginBottom: 8, fontWeight: 700 }}>
          📋 快速选择（点击）
        </div>
        {products.slice(0, 8).map(prod => (
          <div key={prod.id}
            onClick={() => doLookup(prod.barcode || prod.sku)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                     borderBottom: `1px solid #ffffff10`, cursor: 'pointer' }}>
            {prod.photo_url && (
              <img src={prod.photo_url} onError={e => e.target.style.display='none'}
                style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover' }} alt="" />
            )}
            <div style={{ flex: 1, fontSize: 12, color: '#F7F5F0', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {prod.name}
              {prod.variant_name && <span style={{ color: C.slateLight }}> · {prod.variant_name}</span>}
            </div>
            <div style={{ fontSize: 12, color: C.orange, fontWeight: 700, flexShrink: 0 }}>
              {totalStock(prod.id)}件
            </div>
          </div>
        ))}
      </div>

      {/* ── Error ────────────────────────────────────────── */}
      {scanView?.error && (
        <div style={{ ...S.card, border: `2px solid ${C.red}` }}>
          <div style={{ color: C.red, fontWeight: 700 }}>❌ {scanView.error}</div>
          <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>
            请检查条码是否已在产品库中，或在产品页新增
          </div>
        </div>
      )}

      {/* ── Product detail ───────────────────────────────── */}
      {p && (
        <div>
          {/* Product card */}
          <div style={{ ...S.card, border: `2px solid ${C.orange}33` }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <ProductPhoto url={p.photo_url} size={72} radius={12} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.3 }}>{p.name}</div>
                {p.variant_name && (
                  <div style={{ fontSize: 13, color: C.orange, fontWeight: 600 }}>{p.variant_name}</div>
                )}
                <div style={{ fontSize: 10, color: C.slateLight, fontFamily: 'monospace', marginTop: 2 }}>
                  {p.sku} · {p.barcode || '无条码'}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[
                ['总库存', `${stock} 件`, stock < p.min_stock ? C.red : C.navy],
                ['成本',   `RM ${(p.cost||0).toFixed(2)}`,   C.navy],
                ['批次数', `${pBat.length} 批`,               C.slate],
              ].map(([l, v, col]) => (
                <div key={l} style={{ textAlign: 'center', background: C.cream, borderRadius: 8, padding: '7px 4px' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: col }}>{v}</div>
                  <div style={{ fontSize: 10, color: C.slate }}>{l}</div>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            {!action && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    setAction('in'); setEditBatch(null)
                    setBatchForm({ batch_no: genBatchNo(), qty: '', received_date: todayStr,
                                   expiry_date: '', cost: String(p.cost || '') })
                  }}
                  style={S.btn(C.green, true, true)}>📦 入库</button>
                <button onClick={() => { setAction('out'); setOutQty(1) }}
                  style={S.btn(C.red, true, true)}>📤 出库</button>
              </div>
            )}
          </div>

          {/* Batch list */}
          <div style={S.card}>
            <div style={S.secTitle}>批次明细（FEFO 顺序）</div>
            {pBat.length === 0 && (
              <div style={{ fontSize: 13, color: C.slateLight, textAlign: 'center', padding: '12px' }}>
                暂无库存批次，点"入库"添加
              </div>
            )}
            {pBat.map((b, i) => {
              const days = b.expiry_date ? daysUntil(b.expiry_date) : null
              const col  = expiryColor(days)
              return (
                <div key={b.id} style={{
                  padding: '10px', borderRadius: 10, marginBottom: 8,
                  background: days !== null && days <= 30 ? col + '12' : C.cream,
                  border: days !== null && days <= 30 ? `1px solid ${col}30` : 'none'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{b.batch_no}</span>
                      {i === 0 && pBat.some(x => x.expiry_date) && (
                        <span style={{ ...S.tag(C.orange), marginLeft: 6 }}>先出</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 16, fontWeight: 900 }}>
                        {b.qty}<span style={{ fontSize: 10, fontWeight: 400, color: C.slate }}> 件</span>
                      </span>
                      <button
                        onClick={() => {
                          setEditBatch(b)
                          setBatchForm({ batch_no: b.batch_no, qty: String(b.qty),
                                         received_date: b.received_date,
                                         expiry_date: b.expiry_date || '',
                                         cost: String(b.cost || p.cost) })
                          setAction('in')
                        }}
                        style={{ background: 'none', border: `1px solid ${C.slate}`, borderRadius: 5,
                                 padding: '3px 7px', fontSize: 10, cursor: 'pointer', color: C.slate }}>
                        编辑
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm('删除此批次？')) return
                          await deleteBatch(b.id)
                          shout('批次已删除')
                        }}
                        style={{ background: 'none', border: `1px solid ${C.red}`, borderRadius: 5,
                                 padding: '3px 7px', fontSize: 10, cursor: 'pointer', color: C.red }}>
                        删
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.slate }}>
                    入库：{b.received_date} · RM {(b.cost || 0).toFixed(2)}/件
                  </div>
                  {b.expiry_date && (
                    <div style={{ fontSize: 11, color: col, fontWeight: 700, marginTop: 3 }}>
                      {days <= 0  ? '⛔ 已过期'
                       : days <= 14 ? `🔴 ${days} 天到期`
                       : days <= 30 ? `🟡 ${days} 天到期`
                       :              `✅ ${days} 天到期`}
                      {' · '}{b.expiry_date}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Stock IN form */}
          {action === 'in' && (
            <div style={{ ...S.card, border: `2px solid ${C.green}40` }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: C.green }}>
                {editBatch ? '✏ 编辑批次' : '📦 新增入库批次'}
              </div>
              {[
                ['批次号',              'batch_no',      'text'],
                ['入库数量 *',          'qty',           'number'],
                ['入库日期',            'received_date', 'date'],
                ...(p.has_expiry ? [['有效日期', 'expiry_date', 'date']] : []),
                ['成本 RM/件',          'cost',          'number'],
              ].map(([l, k, t]) => (
                <div key={k} style={{ marginBottom: 10 }}>
                  <label style={S.lbl}>{l}</label>
                  <input type={t} style={S.inp} value={batchForm[k] || ''}
                    onChange={e => setBatchForm(f => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
              {p.has_expiry && (
                <div style={{ fontSize: 11, color: C.purple, marginBottom: 10,
                              padding: '7px 10px', background: C.purple + '12', borderRadius: 8 }}>
                  ⚠ 此产品启用效期管理，请填写有效日期
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleStockIn} style={S.btn(C.green)}>
                  ✓ {editBatch ? '保存更改' : '确认入库'}
                </button>
                <button onClick={() => { setAction(null); setEditBatch(null) }}
                  style={S.btn(C.slate, false)}>取消</button>
              </div>
            </div>
          )}

          {/* Stock OUT form */}
          {action === 'out' && (
            <div style={{ ...S.card, border: `2px solid ${C.red}40` }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: C.red }}>
                📤 出库
              </div>
              <div style={{ fontSize: 11, color: C.slate, marginBottom: 12 }}>
                FEFO 自动先出最早到期批次
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={S.lbl}>出库数量（现有 {stock} 件）</label>
                <input type="number" min={1} max={stock} style={S.inp}
                  value={outQty} onChange={e => setOutQty(parseInt(e.target.value) || 1)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
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
