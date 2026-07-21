// src/pages/ContentStudioPage.jsx
// 智能作图 · AI 营销工作台（v2：可拖拽排版 + 自定义标注贴纸）
// 流程：上传实物图 → AI 生成卖点文案 → 拖拽调整图片/文字位置、颜色、大小 → 加标注贴纸 → 下载
import { useState, useRef, useEffect, useCallback } from 'react'
import { C, S } from '../App'
import { supabase } from '../lib/supabase'

const CANVAS_SIZE = 800
const BG_STYLES = {
  minimal: { label:'简约白底风', bg:'#F7F5F0' },
  promo:   { label:'大促促销风', bg:'gradient' },
  pastel:  { label:'柔和种草风', bg:'#FFF0EE' },
}
const BADGE_COLORS = ['#F39C12','#EE4D2D','#2ECC71','#3498DB','#9B59B6','#0F1B2D']

// ── 画布绘制 ─────────────────────────────────────────────────
function roundRectPath(ctx,x,y,w,h,r) {
  ctx.beginPath()
  ctx.moveTo(x+r,y)
  ctx.arcTo(x+w,y,x+w,y+h,r)
  ctx.arcTo(x+w,y+h,x,y+h,r)
  ctx.arcTo(x,y+h,x,y,r)
  ctx.arcTo(x,y,x+w,y,r)
  ctx.closePath()
}

function drawScene(canvas, layers, imgEl, template, selectedId) {
  const size = CANVAS_SIZE
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')

  // 背景
  const style = BG_STYLES[template] || BG_STYLES.minimal
  if (style.bg === 'gradient') {
    const g = ctx.createLinearGradient(0,0,size,size)
    g.addColorStop(0,'#FF6B35'); g.addColorStop(1,'#E74C3C')
    ctx.fillStyle = g
  } else {
    ctx.fillStyle = style.bg
  }
  ctx.fillRect(0,0,size,size)

  layers.forEach(l => {
    if (l.type === 'image') {
      if (!imgEl) return
      ctx.save()
      roundRectPath(ctx, l.x-l.w/2, l.y-l.h/2, l.w, l.h, 24)
      ctx.clip()
      ctx.drawImage(imgEl, l.x-l.w/2, l.y-l.h/2, l.w, l.h)
      ctx.restore()
      if (l.id === selectedId) drawSelectionBox(ctx, l.x-l.w/2, l.y-l.h/2, l.w, l.h)

    } else if (l.type === 'text') {
      ctx.font = `${l.bold?'bold ':''}${l.fontSize}px sans-serif`
      ctx.fillStyle = l.color
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(l.text, l.x, l.y)
      const w = ctx.measureText(l.text).width
      l._w = w; l._h = l.fontSize*1.3
      if (l.id === selectedId) drawSelectionBox(ctx, l.x-w/2-6, l.y-l._h/2, w+12, l._h)

    } else if (l.type === 'badge') {
      ctx.font = `bold ${l.fontSize}px sans-serif`
      const padX=14, padY=8
      const w = ctx.measureText(l.text).width + padX*2
      const h = l.fontSize + padY*2
      ctx.fillStyle = l.bg
      roundRectPath(ctx, l.x-w/2, l.y-h/2, w, h, h/2)
      ctx.fill()
      ctx.fillStyle = l.color
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(l.text, l.x, l.y)
      l._w = w; l._h = h
      if (l.id === selectedId) drawSelectionBox(ctx, l.x-w/2-4, l.y-h/2-4, w+8, h+8)
    }
  })
}

function drawSelectionBox(ctx,x,y,w,h) {
  ctx.save()
  ctx.strokeStyle = '#3498DB'; ctx.lineWidth = 2; ctx.setLineDash([6,4])
  ctx.strokeRect(x,y,w,h)
  ctx.restore()
}

function hitTest(layers, px, py) {
  for (let i=layers.length-1; i>=0; i--) {
    const l = layers[i]
    if (l.type==='image') {
      if (px>=l.x-l.w/2 && px<=l.x+l.w/2 && py>=l.y-l.h/2 && py<=l.y+l.h/2) return l.id
    } else {
      const w = (l._w||80)+16, h = (l._h||24)+16
      if (px>=l.x-w/2 && px<=l.x+w/2 && py>=l.y-h/2 && py<=l.y+h/2) return l.id
    }
  }
  return null
}

const defaultLayers = (copy) => ([
  { id:'img',  type:'image', x:CANVAS_SIZE/2, y:CANVAS_SIZE*0.5, w:CANVAS_SIZE*0.6, h:CANVAS_SIZE*0.6 },
  { id:'tagline', type:'text', x:CANVAS_SIZE/2, y:70, text:copy.tagline, fontSize:38, color:'#0F1B2D', bold:true },
  { id:'sp0', type:'text', x:CANVAS_SIZE/2, y:CANVAS_SIZE-110, text:'✓ '+copy.selling_points[0], fontSize:22, color:'#4A6080' },
  { id:'sp1', type:'text', x:CANVAS_SIZE/2, y:CANVAS_SIZE-78,  text:'✓ '+copy.selling_points[1], fontSize:22, color:'#4A6080' },
  { id:'sp2', type:'text', x:CANVAS_SIZE/2, y:CANVAS_SIZE-46,  text:'✓ '+copy.selling_points[2], fontSize:22, color:'#4A6080' },
])

export default function ContentStudioPage({ shout }) {
  const [file,     setFile]     = useState(null)
  const [imgUrl,   setImgUrl]   = useState('')
  const [context,  setContext]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [useSearch, setUseSearch] = useState(false)
  const [searchQueries, setSearchQueries] = useState([])
  const [modelUsed, setModelUsed] = useState('')
  const [template, setTemplate] = useState('minimal')
  const [layers,   setLayers]   = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  const fileRef   = useRef()
  const canvasRef = useRef()
  const imgElRef  = useRef(null)
  const dragRef   = useRef(null)

  const handlePick = (e) => {
    const f = e.target.files[0]; if (!f) return
    setFile(f); setLayers(null); setSelectedId(null)
    setImgUrl(URL.createObjectURL(f))
  }

  const handleGenerate = async () => {
    if (!file) { shout('请先上传商品图片',true); return }
    setLoading(true)
    try {
      const base64 = await new Promise((resolve,reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const { data, error } = await supabase.functions.invoke('generate-copy', {
        body: { image: base64, mediaType: file.type||'image/jpeg', context, useSearch },
      })
      if (error) {
        // supabase-js 遇到非 2xx 响应时，error.message 只会给一句很笼统的提示，
        // 真正的错误原因要自己从 error.context（原始 Response）里读出来
        let detail = error.message
        try {
          const body = await error.context.json()
          if (body?.error) detail = body.error
        } catch {}
        throw new Error(detail)
      }
      if (data?.error) throw new Error(data.error)
      const copy = {
        tagline: data.tagline || '主标语',
        selling_points: (data.selling_points && data.selling_points.length===3) ? data.selling_points : ['卖点1','卖点2','卖点3'],
      }
      setLayers(defaultLayers(copy))
      setSearchQueries(data._searchQueries || [])
      setModelUsed(data._modelUsed || '')
      shout('文案生成好了，可以开始拖拽排版了 ✓')
    } catch(e) {
      shout('生成失败：'+(e.message||'请检查网络或后台设置'), true)
    }
    setLoading(false)
  }

  // 图片加载
  useEffect(() => {
    if (!imgUrl) { imgElRef.current = null; return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { imgElRef.current = img; redraw() }
    img.src = imgUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgUrl])

  const redraw = useCallback(() => {
    if (!canvasRef.current || !layers) return
    drawScene(canvasRef.current, layers, imgElRef.current, template, selectedId)
  }, [layers, template, selectedId])

  useEffect(() => { redraw() }, [redraw])

  const getCanvasPoint = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const cx = e.touches ? e.touches[0].clientX : e.clientX
    const cy = e.touches ? e.touches[0].clientY : e.clientY
    return { x:(cx-rect.left)*scaleX, y:(cy-rect.top)*scaleY }
  }

  const handlePointerDown = (e) => {
    if (!layers) return
    const { x, y } = getCanvasPoint(e)
    const id = hitTest(layers, x, y)
    if (id) {
      const l = layers.find(l=>l.id===id)
      dragRef.current = { id, offsetX:x-l.x, offsetY:y-l.y }
      setSelectedId(id)
    } else {
      setSelectedId(null)
    }
  }
  const handlePointerMove = (e) => {
    if (!dragRef.current) return
    e.preventDefault()
    const { x, y } = getCanvasPoint(e)
    const { id, offsetX, offsetY } = dragRef.current
    setLayers(ls => ls.map(l => l.id===id ? {...l, x:x-offsetX, y:y-offsetY} : l))
  }
  const handlePointerUp = () => { dragRef.current = null }

  const selectedLayer = layers?.find(l=>l.id===selectedId)

  const updateSelected = (patch) => {
    setLayers(ls => ls.map(l => l.id===selectedId ? {...l, ...patch} : l))
  }

  const addBadge = () => {
    if (!layers) return
    const id = 'badge-'+Date.now()
    setLayers(ls => [...ls, { id, type:'badge', x:CANVAS_SIZE/2, y:CANVAS_SIZE*0.5,
      text:'新标注', fontSize:18, color:'#fff', bg:BADGE_COLORS[0] }])
    setSelectedId(id)
  }
  const deleteSelected = () => {
    if (!selectedId || !selectedLayer || selectedLayer.type==='image') return
    setLayers(ls => ls.filter(l=>l.id!==selectedId))
    setSelectedId(null)
  }
  const resetLayout = () => {
    if (!layers) return
    const tagline = layers.find(l=>l.id==='tagline')?.text || ''
    const sp = ['sp0','sp1','sp2'].map(id => (layers.find(l=>l.id===id)?.text||'').replace(/^✓\s*/,''))
    setLayers(defaultLayers({ tagline, selling_points: sp }))
    setSelectedId(null)
  }

  const handleDownload = () => {
    if (!canvasRef.current) return
    setSelectedId(null)
    setTimeout(() => {
      const link = document.createElement('a')
      link.download = `营销图_${Date.now()}.png`
      link.href = canvasRef.current.toDataURL('image/png')
      link.click()
    }, 50) // 等取消选中框重画一次，下载的图不带蓝色虚线框
  }

  return (
    <div>
      <div style={S.card}>
        <div style={S.secTitle}>1. 上传商品实物图</div>
        <div onClick={()=>fileRef.current?.click()}
          style={{width:'100%',aspectRatio:'1',borderRadius:14,background:C.cream,
                 border:`2px dashed ${C.slateLight}60`,cursor:'pointer',
                 display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
          {imgUrl
            ? <img src={imgUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
            : <div style={{textAlign:'center',color:C.slate}}>
                <div style={{fontSize:32}}>📷</div>
                <div style={{fontSize:12,marginTop:4}}>点击上传实物图</div>
              </div>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePick}/>

        <div style={{marginTop:12}}>
          <label style={S.lbl}>补充说明（选填，帮 AI 更准确）</label>
          <input style={S.inp} placeholder="例：日本进口，敏感肌适用，30ml"
            value={context} onChange={e=>setContext(e.target.value)}/>
        </div>

        <div style={{marginTop:12,display:'flex',alignItems:'center',gap:8}}>
          <div onClick={()=>setUseSearch(v=>!v)}
            style={{width:38,height:22,borderRadius:11,cursor:'pointer',position:'relative',
                   background:useSearch?C.blue:C.slateLight,transition:'all .2s'}}>
            <div style={{position:'absolute',top:2,left:useSearch?18:2,
                         width:18,height:18,borderRadius:9,background:'#fff',transition:'all .2s'}}/>
          </div>
          <div style={{fontSize:11,color:C.slate}}>
            🔍 联网参考同类商品热门关键词
          </div>
        </div>

        <button onClick={handleGenerate} disabled={!file||loading}
          style={{...S.btn(C.orange),marginTop:12,opacity:(!file||loading)?0.6:1}}>
          {loading?(useSearch?'🔍 搜索 + 生成中…':'🪄 AI 生成中…'):(layers?'🔄 重新生成文案':'🪄 生成卖点文案（免费）')}
        </button>
        {modelUsed && (
          <div style={{fontSize:10,color:C.slateLight,marginTop:8}}>
            🤖 这次用的型号：{modelUsed}
          </div>
        )}
        {searchQueries.length>0 && (
          <div style={{fontSize:10,color:C.slateLight,marginTop:8}}>
            🔍 刚才搜索了：{searchQueries.join('、')}
          </div>
        )}
      </div>

      {layers && (
        <div style={S.card}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={S.secTitle}>2. 拖拽排版 · 点一下选中再调整</div>
            <button onClick={resetLayout}
              style={{background:'none',border:`1px solid ${C.slate}40`,borderRadius:6,
                     padding:'3px 9px',fontSize:10,color:C.slate,cursor:'pointer'}}>
              ↺ 重置排版
            </button>
          </div>

          <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
            {Object.entries(BG_STYLES).map(([id,s])=>(
              <button key={id} onClick={()=>setTemplate(id)}
                style={{padding:'6px 12px',borderRadius:20,border:'none',cursor:'pointer',
                  background:template===id?C.orange:C.cream,
                  color:template===id?'#fff':C.slate,
                  fontWeight:template===id?700:400,fontSize:11}}>
                {s.label}
              </button>
            ))}
          </div>

          <canvas ref={canvasRef}
            style={{width:'100%',borderRadius:12,display:'block',touchAction:'none',cursor:'grab'}}
            onMouseDown={handlePointerDown} onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp} onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown} onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />

          <button onClick={addBadge} style={{...S.btn(C.blue,true,true),marginTop:10}}>
            🏷 添加标注贴纸（尺寸/须知/亮点…）
          </button>

          {/* ── 选中元素的调整面板 ─────────────────────────── */}
          {selectedLayer && (
            <div style={{marginTop:12,padding:'10px 12px',background:C.cream,borderRadius:10}}>
              <div style={{fontSize:11,fontWeight:700,color:C.navy,marginBottom:8}}>
                {selectedLayer.type==='image' ? '📷 商品图片' : selectedLayer.type==='badge' ? '🏷 标注贴纸' : '🔤 文字'}
              </div>

              {selectedLayer.type !== 'image' && (
                <div style={{marginBottom:8}}>
                  <label style={S.lbl}>内容</label>
                  <input style={S.inp} value={selectedLayer.text}
                    onChange={e=>updateSelected({text:e.target.value})}/>
                </div>
              )}

              {selectedLayer.type === 'image' ? (
                <div style={{marginBottom:8}}>
                  <label style={S.lbl}>图片大小</label>
                  <input type="range" min={CANVAS_SIZE*0.25} max={CANVAS_SIZE*0.95} value={selectedLayer.w}
                    style={{width:'100%'}}
                    onChange={e=>{const v=+e.target.value; updateSelected({w:v,h:v})}}/>
                </div>
              ) : (
                <div style={{marginBottom:8}}>
                  <label style={S.lbl}>字体大小</label>
                  <input type="range" min={12} max={64} value={selectedLayer.fontSize}
                    style={{width:'100%'}}
                    onChange={e=>updateSelected({fontSize:+e.target.value})}/>
                </div>
              )}

              {selectedLayer.type !== 'image' && (
                <div style={{marginBottom:8}}>
                  <label style={S.lbl}>文字颜色</label>
                  <input type="color" value={selectedLayer.color}
                    style={{width:'100%',height:32,border:'none',borderRadius:6,cursor:'pointer'}}
                    onChange={e=>updateSelected({color:e.target.value})}/>
                </div>
              )}

              {selectedLayer.type === 'badge' && (
                <>
                  <div style={{marginBottom:8}}>
                    <label style={S.lbl}>贴纸底色</label>
                    <div style={{display:'flex',gap:6}}>
                      {BADGE_COLORS.map(c=>(
                        <div key={c} onClick={()=>updateSelected({bg:c})}
                          style={{width:26,height:26,borderRadius:13,background:c,cursor:'pointer',
                                 border:selectedLayer.bg===c?`2px solid ${C.navy}`:'2px solid transparent'}}/>
                      ))}
                    </div>
                  </div>
                  <button onClick={deleteSelected}
                    style={{...S.btn(C.red,true,true)}}>
                    🗑 删除这个标注
                  </button>
                </>
              )}
            </div>
          )}

          <button onClick={handleDownload} style={{...S.btn(C.green),marginTop:14}}>
            💾 下载营销图
          </button>
        </div>
      )}
    </div>
  )
}
