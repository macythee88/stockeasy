// src/components/BarcodeScanner.jsx
// 通用扫码组件 — 用于新增产品和入货单
// 使用方式：
//   <BarcodeScanner onScan={(code) => setBarcode(code)} />

import { useState, useRef, useEffect, useCallback } from 'react'

const C = {
  orange:'#FF6B35', navy:'#0F1B2D', slate:'#4A6080',
  slateLight:'#8FA3BC', cream:'#F7F5F0', red:'#E74C3C', green:'#2ECC71',
}

export default function BarcodeScanner({ onScan, placeholder = "扫描或输入条码…", value = '', onChange }) {
  const [camOpen,    setCamOpen]    = useState(false)
  const [camError,   setCamError]   = useState(null)
  const [camLoading, setCamLoading] = useState(false)
  const [supported,  setSupported]  = useState(null)
  const [torchOn,    setTorchOn]    = useState(false)

  const videoRef    = useRef()
  const streamRef   = useRef(null)
  const detectorRef = useRef(null)
  const rafRef      = useRef(null)
  const scanningRef = useRef(false)
  const inputRef    = useRef()

  // Check BarcodeDetector support
  useEffect(() => {
    if ('BarcodeDetector' in window) {
      setSupported('detector')
    } else if (navigator.mediaDevices) {
      setSupported('camera-only') // can show camera but no auto-detect
    } else {
      setSupported('none')
    }
  }, [])

  const stopCamera = useCallback(() => {
    scanningRef.current = false
    cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setCamOpen(false); setTorchOn(false); setCamError(null)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

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
        stopCamera()
        onScan(code)
      } else {
        rafRef.current = requestAnimationFrame(scanLoop)
      }
    }).catch(() => {
      rafRef.current = requestAnimationFrame(scanLoop)
    })
  }, [onScan, stopCamera])

  const startCamera = async () => {
    setCamLoading(true); setCamError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamOpen(true)
      if (supported === 'detector') {
        detectorRef.current = new BarcodeDetector({
          formats: ['ean_13','ean_8','code_128','code_39','qr_code','upc_a','upc_e','itf','codabar']
        })
        scanningRef.current = true
        scanLoop()
      }
    } catch (e) {
      const msg =
        e.name === 'NotAllowedError'  ? '请允许摄像头权限\n地址栏 🔒 → 摄像头 → 允许，然后重试' :
        e.name === 'NotFoundError'    ? '找不到摄像头' :
        e.name === 'NotReadableError' ? '摄像头被其他应用占用' :
        `错误：${e.message}`
      setCamError(msg)
    }
    setCamLoading(false)
  }

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] })
      setTorchOn(t => !t)
    } catch {}
  }

  return (
    <div>
      {/* Input row with camera button */}
      <div style={{ display:'flex', gap:8 }}>
        <input
          ref={inputRef}
          type="text"
          style={{
            flex:1, padding:'11px 13px', borderRadius:8,
            border:`1.5px solid #8FA3BC50`, fontSize:14,
            outline:'none', background:'#fff', fontFamily:'monospace',
            boxSizing:'border-box'
          }}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange && onChange(e.target.value)}
        />
        {/* Camera button */}
        {supported !== 'none' && (
          <button
            type="button"
            onClick={() => camOpen ? stopCamera() : startCamera()}
            style={{
              background: camOpen ? C.red : C.orange,
              color:'#fff', border:'none', borderRadius:8,
              padding:'0 14px', fontSize:20, cursor:'pointer',
              flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
              minWidth:48
            }}
            title="开启相机扫码"
          >
            {camOpen ? '✕' : '📷'}
          </button>
        )}
      </div>

      {/* Loading */}
      {camLoading && (
        <div style={{ textAlign:'center', padding:'16px', color:C.slate, fontSize:13 }}>
          📷 启动摄像头中…
        </div>
      )}

      {/* Camera modal */}
      {camOpen && !camLoading && (
        <div style={{
          marginTop:10, borderRadius:12, overflow:'hidden',
          position:'relative', background:'#000', aspectRatio:'4/3'
        }}>
          <video ref={videoRef} playsInline muted autoPlay
            style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>

          {/* Scan frame overlay */}
          <div style={{
            position:'absolute', inset:0, display:'flex',
            alignItems:'center', justifyContent:'center', pointerEvents:'none'
          }}>
            <div style={{
              width:'70%', aspectRatio:'2', position:'relative',
              border:`2px solid ${C.orange}70`, borderRadius:8
            }}>
              <div style={{
                position:'absolute', left:0, right:0, height:2,
                background:`linear-gradient(90deg,transparent,${C.orange},transparent)`,
                animation:'bscan 1.8s ease-in-out infinite'
              }}/>
            </div>
          </div>

          {/* Hint */}
          <div style={{
            position:'absolute', top:10, left:0, right:0, textAlign:'center'
          }}>
            <span style={{
              background:'rgba(0,0,0,0.55)', color:'#fff',
              fontSize:11, borderRadius:20, padding:'4px 14px'
            }}>
              {supported==='detector' ? '对准条码自动识别' : '对准后手动输入条码'}
            </span>
          </div>

          {/* Controls */}
          <div style={{
            position:'absolute', bottom:10, left:0, right:0,
            display:'flex', justifyContent:'center', gap:10
          }}>
            <button type="button" onClick={toggleTorch} style={{
              background: torchOn ? '#F39C12' : 'rgba(0,0,0,0.6)',
              color:'#fff', border:'none', borderRadius:20,
              padding:'7px 16px', fontSize:12, cursor:'pointer'
            }}>🔦 {torchOn?'关':'开'}闪光</button>
            <button type="button" onClick={stopCamera} style={{
              background:'rgba(231,76,60,0.85)', color:'#fff',
              border:'none', borderRadius:20,
              padding:'7px 16px', fontSize:12, cursor:'pointer'
            }}>✕ 关闭</button>
          </div>
        </div>
      )}

      {/* Camera-only mode: manual input below video */}
      {camOpen && supported === 'camera-only' && (
        <div style={{ marginTop:8, display:'flex', gap:8 }}>
          <input
            type="text"
            style={{
              flex:1, padding:'10px 12px', borderRadius:8,
              border:`1.5px solid ${C.orange}`, fontSize:14,
              outline:'none', background:'#fff', fontFamily:'monospace',
              boxSizing:'border-box'
            }}
            placeholder="对准条码后手动输入…"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                onScan(e.target.value.trim())
                stopCamera()
              }
            }}
          />
        </div>
      )}

      {/* Error */}
      {camError && (
        <div style={{
          marginTop:8, background:'#E74C3C12',
          border:'1px solid #E74C3C30', borderRadius:8, padding:'10px 12px'
        }}>
          <div style={{ fontSize:12, color:C.red, fontWeight:700, marginBottom:4 }}>⚠ 摄像头问题</div>
          <div style={{ fontSize:11, lineHeight:1.7, whiteSpace:'pre-line' }}>{camError}</div>
          <button type="button" onClick={startCamera} style={{
            marginTop:8, background:C.orange, color:'#fff', border:'none',
            borderRadius:6, padding:'6px 14px', fontSize:12, cursor:'pointer'
          }}>🔄 重试</button>
        </div>
      )}

      <style>{`
        @keyframes bscan {
          0%   { top: 5%  }
          50%  { top: 90% }
          100% { top: 5%  }
        }
      `}</style>
    </div>
  )
}
