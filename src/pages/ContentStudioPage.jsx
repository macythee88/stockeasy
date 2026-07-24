// src/pages/ContentStudioPage.jsx
// 智能作图 · AI 营销工作台（v4：4 类标准贴纸 + 常用套话记忆 + 一键主题切换 + 高清导出）
import { useState, useRef, useEffect, useCallback } from 'react'
import { C, S } from '../App'
import { supabase } from '../lib/supabase'

const CANVAS_SIZE = 1200 // 高清导出，符合 Shopee/Lazada 主图规范
const SCALE = CANVAS_SIZE / 800 // 相对之前 800 画布的换算比例，字体/间距都乘这个

const BG_STYLES = {
  minimal: { label:'简约白底风', bg:'#F7F5F0' },
  promo:   { label:'大促促销风', bg:'gradient' },
  pastel:  { label:'柔和种草风', bg:'#FFF0EE' },
}
const BADGE_COLORS = ['#F39C12','#EE4D2D','#2ECC71','#3498DB','#9B59B6','#0F1B2D']
const LANGS = { zh:'中文', en:'英文', both:'中英双语' }

// ── 常用套话：存在浏览器本地，加过一次以后每次都能快速选 ──────────
const PHRASE_KEY = 'stockeasy_studio_phrases'
const DEFAULT_PHRASES = ['✈️ Free Speedpost','🔥 Ready Stock in Singapore','🇯🇵 Japan Stock','现货速发','日本直邮']
const loadPhrases = () => {
  try { return [...new Set([...JSON.parse(localStorage.getItem(PHRASE_KEY)||'[]'), ...DEFAULT_PHRASES])] }
  catch { return DEFAULT_PHRASES }
}
const savePhrase = (text) => {
  if (!text?.trim()) return
  try {
    const list = JSON.parse(localStorage.getItem(PHRASE_KEY)||'[]')
    const next = [text, ...list.filter(t=>t!==text)].slice(0,15)
    localStorage.setItem(PHRASE_KEY, JSON.stringify(next))
  } catch {}
}

const pickText = (zh, en, lang) => {
  if (lang==='en') return en || zh || ''
  if (lang==='both') return en ? `${zh}\n${en}` : (zh||'')
  return zh || en || ''
}

// ── 版面模板：图片/标语/卖点的默认摆放（背景风格是分开的另一件事）──
const LAYOUTS = {
  classic: {
    label: '标准竖版（标语上·卖点下）',
    build: (copy, lang) => ([
      { id:'img',  type:'image', x:CANVAS_SIZE/2, y:CANVAS_SIZE*0.5, w:CANVAS_SIZE*0.55, h:CANVAS_SIZE*0.55 },
      { id:'tagline', type:'text', x:CANVAS_SIZE/2, y:100*SCALE, text:pickText(copy.tagline,copy.tagline_en,lang), fontSize:36*SCALE, color:'#0F1B2D', bold:true, align:'center' },
      { id:'sp0', type:'text', x:CANVAS_SIZE/2, y:CANVAS_SIZE-180*SCALE, text:pickText('✓ '+copy.selling_points[0], copy.selling_points_en?.[0], lang), fontSize:20*SCALE, color:'#4A6080', align:'center' },
      { id:'sp1', type:'text', x:CANVAS_SIZE/2, y:CANVAS_SIZE-120*SCALE, text:pickText('✓ '+copy.selling_points[1], copy.selling_points_en?.[1], lang), fontSize:20*SCALE, color:'#4A6080', align:'center' },
      { id:'sp2', type:'text', x:CANVAS_SIZE/2, y:CANVAS_SIZE-60*SCALE,  text:pickText('✓ '+copy.selling_points[2], copy.selling_points_en?.[2], lang), fontSize:20*SCALE, color:'#4A6080', align:'center' },
    ]),
  },
  sideBullets: {
    label: '卖点侧边版（标语上·卖点右）',
    build: (copy, lang) => ([
      { id:'img',  type:'image', x:CANVAS_SIZE*0.36, y:CANVAS_SIZE*0.56, w:CANVAS_SIZE*0.56, h:CANVAS_SIZE*0.56 },
      { id:'tagline', type:'text', x:CANVAS_SIZE/2, y:90*SCALE, text:pickText(copy.tagline,copy.tagline_en,lang), fontSize:32*SCALE, color:'#0F1B2D', bold:true, align:'center' },
      { id:'sp0', type:'text', x:CANVAS_SIZE*0.72, y:CANVAS_SIZE*0.42, text:pickText('✓ '+copy.selling_points[0], copy.selling_points_en?.[0], lang), fontSize:18*SCALE, color:'#4A6080', align:'left' },
      { id:'sp1', type:'text', x:CANVAS_SIZE*0.72, y:CANVAS_SIZE*0.56, text:pickText('✓ '+copy.selling_points[1], copy.selling_points_en?.[1], lang), fontSize:18*SCALE, color:'#4A6080', align:'left' },
      { id:'sp2', type:'text', x:CANVAS_SIZE*0.72, y:CANVAS_SIZE*0.70, text:pickText('✓ '+copy.selling_points[2], copy.selling_points_en?.[2], lang), fontSize:18*SCALE, color:'#4A6080', align:'left' },
    ]),
  },
  bigPromo: {
    label: '促销大字版（标语超大·卖点一排）',
    build: (copy, lang) => ([
      { id:'img',  type:'image', x:CANVAS_SIZE/2, y:CANVAS_SIZE*0.46, w:CANVAS_SIZE*0.48, h:CANVAS_SIZE*0.48 },
      { id:'tagline', type:'text', x:CANVAS_SIZE/2, y:120*SCALE, text:pickText(copy.tagline,copy.tagline_en,lang), fontSize:44*SCALE, color:'#fff', bold:true, align:'center' },
      { id:'sp0', type:'badge', x:CANVAS_SIZE*0.2, y:CANVAS_SIZE-100*SCALE, text:pickText(copy.selling_points[0], copy.selling_points_en?.[0], lang==='both'?'zh':lang), fontSize:15*SCALE, color:'#0F1B2D', bg:'#fff' },
      { id:'sp1', type:'badge', x:CANVAS_SIZE*0.5, y:CANVAS_SIZE-100*SCALE, text:pickText(copy.selling_points[1], copy.selling_points_en?.[1], lang==='both'?'zh':lang), fontSize:15*SCALE, color:'#0F1B2D', bg:'#fff' },
      { id:'sp2', type:'badge', x:CANVAS_SIZE*0.8, y:CANVAS_SIZE-100*SCALE, text:pickText(copy.selling_points[2], copy.selling_points_en?.[2], lang==='both'?'zh':lang), fontSize:15*SCALE, color:'#0F1B2D', bg:'#fff' },
    ]),
  },
}

// ── 一键主题：layout + 背景 + 预设装饰图层的组合，不用重新调 AI ────
const THEMES = {
  freshJP:  { label:'日系清爽', layoutId:'classic', bgStyle:'minimal', extras:[] },
  bigRed:   { label:'大红促销', layoutId:'bigPromo', bgStyle:'promo', extras:[
    { type:'medal', text:'限时', corner:'tr' },
  ]},
  minimalLux: { label:'极简大牌', layoutId:'sideBullets', bgStyle:'minimal', extras:[] },
  doubleEleven: { label:'双11爆款', layoutId:'bigPromo', bgStyle:'promo', extras:[
    { type:'banner', text:'🔥 双11大促 · 全场限时 🔥', pos:'top' },
    { type:'medal', text:'抢购中', corner:'tr' },
  ]},
}

function buildExtraLayer(spec, idx) {
  const id = `extra-${spec.type}-${idx}`
  if (spec.type==='banner') {
    return { id, type:'banner', x:CANVAS_SIZE/2,
      y: spec.pos==='top' ? 40*SCALE : CANVAS_SIZE-40*SCALE,
      w:CANVAS_SIZE*0.92, h:64*SCALE, text:spec.text, fontSize:24*SCALE, color:'#fff', bg:'#EE4D2D' }
  }
  if (spec.type==='medal') {
    const corners = {
      tr:[CANVAS_SIZE*0.86, CANVAS_SIZE*0.14], tl:[CANVAS_SIZE*0.14, CANVAS_SIZE*0.14],
      br:[CANVAS_SIZE*0.86, CANVAS_SIZE*0.86], bl:[CANVAS_SIZE*0.14, CANVAS_SIZE*0.86],
    }
    const [x,y] = corners[spec.corner] || corners.tr
    return { id, type:'medal', x, y, r:70*SCALE, text:spec.text, fontSize:22*SCALE, color:'#fff', bg:'#F39C12' }
  }
  return null
}

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

function drawMultilineText(ctx, text, x, y, fontSize) {
  const lines = String(text||'').split('\n')
  const lineHeight = fontSize * 1.25
  const totalH = lineHeight * lines.length
  const startY = y - totalH/2 + lineHeight/2
  let maxW = 0
  lines.forEach((line,i) => {
    ctx.fillText(line, x, startY + i*lineHeight)
    maxW = Math.max(maxW, ctx.measureText(line).width)
  })
  return { w:maxW, h:totalH }
}

function drawScene(canvas, layers, imgEl, bgStyle, selectedId) {
  const size = CANVAS_SIZE
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')

  const style = BG_STYLES[bgStyle] || BG_STYLES.minimal
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
      roundRectPath(ctx, l.x-l.w/2, l.y-l.h/2, l.w, l.h, 24*SCALE)
      ctx.clip()
      ctx.drawImage(imgEl, l.x-l.w/2, l.y-l.h/2, l.w, l.h)
      ctx.restore()
      if (l.id === selectedId) drawSelectionBox(ctx, l.x-l.w/2, l.y-l.h/2, l.w, l.h)

    } else if (l.type === 'text') {
      ctx.font = `${l.bold?'bold ':''}${l.fontSize}px sans-serif`
      ctx.fillStyle = l.color
      ctx.textAlign = l.align || 'center'; ctx.textBaseline = 'middle'
      const { w, h } = drawMultilineText(ctx, l.text, l.x, l.y, l.fontSize)
      l._w = w; l._h = h
      if (l.id === selectedId) {
        const boxX = l.align==='left' ? l.x-6 : l.x-w/2-6
        drawSelectionBox(ctx, boxX, l.y-h/2, w+12, h)
      }

    } else if (l.type === 'badge') { // 卖点标签：圆角药丸形，磨砂玻璃感白边
      ctx.font = `bold ${l.fontSize}px sans-serif`
      const padX=14*SCALE, padY=8*SCALE
      const w = ctx.measureText(l.text).width + padX*2
      const h = l.fontSize + padY*2
      ctx.save()
      ctx.globalAlpha = 0.92
      ctx.fillStyle = l.bg
      roundRectPath(ctx, l.x-w/2, l.y-h/2, w, h, h/2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.lineWidth = 2*SCALE; ctx.strokeStyle = '#ffffffaa'
      roundRectPath(ctx, l.x-w/2, l.y-h/2, w, h, h/2); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = l.color
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(l.text, l.x, l.y)
      l._w = w; l._h = h
      if (l.id === selectedId) drawSelectionBox(ctx, l.x-w/2-4, l.y-h/2-4, w+8, h+8)

    } else if (l.type === 'banner') { // 顶部/底部促销横幅：通栏渐变条
      const w = l.w, h = l.h
      ctx.save()
      const g = ctx.createLinearGradient(l.x-w/2,0,l.x+w/2,0)
      g.addColorStop(0, l.bg); g.addColorStop(1, '#F39C12')
      ctx.fillStyle = g
      roundRectPath(ctx, l.x-w/2, l.y-h/2, w, h, 10*SCALE)
      ctx.fill()
      ctx.restore()
      ctx.font = `bold ${l.fontSize}px sans-serif`
      ctx.fillStyle = l.color
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(l.text, l.x, l.y)
      l._w = w; l._h = h
      if (l.id === selectedId) drawSelectionBox(ctx, l.x-w/2, l.y-h/2, w, h)

    } else if (l.type === 'medal') { // 角标勋章：圆形 + 双层描边，放在四个角落
      const r = l.r
      ctx.save()
      ctx.fillStyle = l.bg
      ctx.beginPath(); ctx.arc(l.x, l.y, r, 0, Math.PI*2); ctx.fill()
      ctx.lineWidth = 4*SCALE; ctx.strokeStyle = '#ffffffcc'
      ctx.beginPath(); ctx.arc(l.x, l.y, r-6*SCALE, 0, Math.PI*2); ctx.stroke()
      ctx.restore()
      ctx.font = `bold ${l.fontSize}px sans-serif`
      ctx.fillStyle = l.color
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      drawMultilineText(ctx, l.text, l.x, l.y, l.fontSize)
      l._w = r*2; l._h = r*2
      if (l.id === selectedId) drawSelectionBox(ctx, l.x-r-4, l.y-r-4, r*2+8, r*2+8)
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
    } else if (l.type==='medal') {
      const r=(l._w||100)/2
      if (Math.hypot(px-l.x,py-l.y)<=r+8) return l.id
    } else if (l.type==='text' && l.align==='left') {
      const w=(l._w||80)+16, h=(l._h||24)+16
      if (px>=l.x-16 && px<=l.x-16+w && py>=l.y-h/2 && py<=l.y+h/2) return l.id
    } else {
      const w = (l._w||80)+16, h = (l._h||24)+16
      if (px>=l.x-w/2 && px<=l.x+w/2 && py>=l.y-h/2 && py<=l.y+h/2) return l.id
    }
  }
  return null
}

export default function ContentStudioPage({ shout }) {
  const [file,     setFile]     = useState(null)
  const [imgUrl,   setImgUrl]   = useState('')
  const [context,  setContext]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [useSearch, setUseSearch] = useState(false)
  const [searchQueries, setSearchQueries] = useState([])
  const [modelUsed, setModelUsed] = useState('')
  const [copy,     setCopy]     = useState(null)
  const [description, setDescription] = useState('')
  const [bgStyle,  setBgStyle]  = useState('minimal')
  const [layoutId, setLayoutId] = useState('classic')
  const [lang,     setLang]     = useState('zh')
  const [layers,   setLayers]   = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [phrases,  setPhrases]  = useState(loadPhrases())
  const [showAddPanel, setShowAddPanel] = useState(false) // 加贴纸时选"哪种类型+哪句话"的小面板

  const fileRef   = useRef()
  const canvasRef = useRef()
  const imgElRef  = useRef(null)
  const dragRef   = useRef(null)

  const handlePick = (e) => {
    const f = e.target.files[0]; if (!f) return
    setFile(f); setLayers(null); setCopy(null); setSelectedId(null); setDescription('')
    setImgUrl(URL.createObjectURL(f))
  }

  const handleGenerate = async () => {
    if (!file) { shout('请先上传商品图片',true); return }
    setLoading(true)
    try {
      let base64 = null
      if (!description) {
        base64 = await new Promise((resolve,reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result.split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      }
      const { data, error } = await supabase.functions.invoke('generate-copy', {
        body: { image: base64, mediaType: file.type||'image/jpeg', context, useSearch, description },
      })
      if (error) {
        let detail = error.message
        try { const body = await error.context.json(); if (body?.error) detail = body.error } catch {}
        throw new Error(detail)
      }
      if (data?.error) throw new Error(data.error)

      const newCopy = {
        tagline: data.tagline || '主标语',
        tagline_en: data.tagline_en || '',
        selling_points: (data.selling_points?.length===3) ? data.selling_points : ['卖点1','卖点2','卖点3'],
        selling_points_en: data.selling_points_en?.length===3 ? data.selling_points_en : ['','',''],
        product_summary: data.product_summary || '',
        product_summary_en: data.product_summary_en || '',
      }
      setCopy(newCopy)
      setLayers(LAYOUTS[layoutId].build(newCopy, lang))
      setSearchQueries(data._searchQueries || [])
      setModelUsed(data._modelUsed || '')
      setDescription(data._description || '')
      shout('文案生成好了，可以开始拖拽排版了 ✓')
    } catch(e) {
      shout('生成失败：'+(e.message||'请检查网络或后台设置'), true)
    }
    setLoading(false)
  }

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
    drawScene(canvasRef.current, layers, imgElRef.current, bgStyle, selectedId)
  }, [layers, bgStyle, selectedId])

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
  const updateSelected = (patch) => setLayers(ls => ls.map(l => l.id===selectedId ? {...l, ...patch} : l))

  // ── 加贴纸：先选类型，再从常用套话里选或自己打字 ─────────────
  const addSticker = (type, text) => {
    if (!layers || !text?.trim()) return
    const id = `${type}-${Date.now()}`
    let layer
    if (type==='badge')  layer = { id, type:'badge',  x:CANVAS_SIZE/2, y:CANVAS_SIZE*0.5, text, fontSize:18*SCALE, color:'#fff', bg:BADGE_COLORS[0] }
    if (type==='banner') layer = { id, type:'banner', x:CANVAS_SIZE/2, y:40*SCALE, w:CANVAS_SIZE*0.92, h:64*SCALE, text, fontSize:24*SCALE, color:'#fff', bg:'#EE4D2D' }
    if (type==='medal')  layer = { id, type:'medal',  x:CANVAS_SIZE*0.86, y:CANVAS_SIZE*0.14, r:70*SCALE, text, fontSize:20*SCALE, color:'#fff', bg:'#F39C12' }
    if (!layer) return
    setLayers(ls => [...ls, layer])
    setSelectedId(id)
    setShowAddPanel(false)
    savePhrase(text); setPhrases(loadPhrases())
  }

  const deleteSelected = () => {
    if (!selectedId || !selectedLayer || selectedLayer.type==='image') return
    setLayers(ls => ls.filter(l=>l.id!==selectedId))
    setSelectedId(null)
  }

  const applyLayout = (id) => {
    setLayoutId(id)
    if (copy) setLayers(LAYOUTS[id].build(copy, lang))
    setSelectedId(null)
  }
  const applyLang = (l) => {
    setLang(l)
    if (copy) setLayers(LAYOUTS[layoutId].build(copy, l))
    setSelectedId(null)
  }
  // 一键主题：换 layout + 背景 + 预设装饰贴纸，不用重新调 AI，瞬间重绘
  const applyTheme = (themeId) => {
    if (!copy) return
    const theme = THEMES[themeId]
    setLayoutId(theme.layoutId); setBgStyle(theme.bgStyle)
    const base = LAYOUTS[theme.layoutId].build(copy, lang)
    const extras = theme.extras.map((spec,i)=>buildExtraLayer(spec,i)).filter(Boolean)
    setLayers([...base, ...extras])
    setSelectedId(null)
  }
  const resetLayout = () => {
    if (!copy) return
    setLayers(LAYOUTS[layoutId].build(copy, lang))
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
    }, 50)
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
          <div style={{fontSize:11,color:C.slate}}>🔍 联网参考同类商品热门关键词</div>
        </div>

        <button onClick={handleGenerate} disabled={!file||loading}
          style={{...S.btn(C.orange),marginTop:12,opacity:(!file||loading)?0.6:1}}>
          {loading?(useSearch?'🔍 搜索 + 生成中…':'🪄 AI 生成中…'):(copy?'🔄 重新生成文案':'🪄 生成卖点文案（免费）')}
        </button>

        {modelUsed && <div style={{fontSize:10,color:C.slateLight,marginTop:8}}>🤖 这次用的型号：{modelUsed}</div>}
        {useSearch && searchQueries.length===0 && modelUsed && (
          <div style={{fontSize:10,color:C.slateLight,marginTop:4}}>🔍 这次没有真的触发联网搜索</div>
        )}
        {searchQueries.length>0 && (
          <div style={{fontSize:10,color:C.slateLight,marginTop:8}}>🔍 刚才搜索了：{searchQueries.join('、')}</div>
        )}
      </div>

      {layers && (
        <div style={S.card}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={S.secTitle}>2. 一键主题 / 拖拽排版</div>
            <button onClick={resetLayout}
              style={{background:'none',border:`1px solid ${C.slate}40`,borderRadius:6,
                     padding:'3px 9px',fontSize:10,color:C.slate,cursor:'pointer'}}>
              ↺ 重置排版
            </button>
          </div>

          {copy?.product_summary && (
            <div style={{fontSize:11,color:C.navy,marginBottom:12,padding:'8px 10px',background:C.cream,borderRadius:8}}>
              🤖 AI 识别的商品：{copy.product_summary}
              {copy.product_summary_en && <><br/><span style={{color:C.slate}}>{copy.product_summary_en}</span></>}
            </div>
          )}

          <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>
            🎨 一键主题（换风格不用重新调 AI，秒切换）
          </div>
          <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
            {Object.entries(THEMES).map(([id,t])=>(
              <button key={id} onClick={()=>applyTheme(id)}
                style={{padding:'8px 14px',borderRadius:20,border:'none',cursor:'pointer',
                  background:C.navy,color:'#fff',fontSize:12,fontWeight:700}}>
                {t.label}
              </button>
            ))}
          </div>

          <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>版面模板</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
            {Object.entries(LAYOUTS).map(([id,l])=>(
              <button key={id} onClick={()=>applyLayout(id)}
                style={{padding:'8px 12px',borderRadius:10,border:`2px solid ${layoutId===id?C.orange:C.slateLight+'40'}`,
                  background:layoutId===id?C.orange+'10':'#fff',cursor:'pointer',textAlign:'left',
                  fontSize:12,fontWeight:layoutId===id?700:400,color:layoutId===id?C.orange:C.navy}}>
                {l.label}
              </button>
            ))}
          </div>

          <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>背景风格</div>
          <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
            {Object.entries(BG_STYLES).map(([id,s])=>(
              <button key={id} onClick={()=>setBgStyle(id)}
                style={{padding:'6px 12px',borderRadius:20,border:'none',cursor:'pointer',
                  background:bgStyle===id?C.orange:C.cream,color:bgStyle===id?'#fff':C.slate,
                  fontWeight:bgStyle===id?700:400,fontSize:11}}>
                {s.label}
              </button>
            ))}
          </div>

          <div style={{fontSize:11,fontWeight:700,color:C.slate,marginBottom:6}}>文案语言</div>
          <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
            {Object.entries(LANGS).map(([id,label])=>(
              <button key={id} onClick={()=>applyLang(id)}
                style={{padding:'6px 12px',borderRadius:20,border:'none',cursor:'pointer',
                  background:lang===id?C.blue:C.cream,color:lang===id?'#fff':C.slate,
                  fontWeight:lang===id?700:400,fontSize:11}}>
                {label}
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

          <button onClick={()=>setShowAddPanel(v=>!v)} style={{...S.btn(C.blue,true,true),marginTop:10}}>
            🏷 添加标注贴纸
          </button>

          {showAddPanel && (
            <div style={{marginTop:10,padding:'10px 12px',background:C.cream,borderRadius:10}}>
              <div style={{fontSize:11,fontWeight:700,color:C.navy,marginBottom:8}}>选个类型</div>
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {[['badge','💬 卖点气泡（贴哪都行）'],['banner','🎗 促销横幅（通栏）'],['medal','🥇 角标勋章（四角）']].map(([t,l])=>(
                  <button key={t} onClick={()=>setShowAddPanel(t)}
                    style={{padding:'5px 10px',borderRadius:16,border:'none',cursor:'pointer',
                      background:showAddPanel===t?C.blue:'#fff',color:showAddPanel===t?'#fff':C.slate,fontSize:11}}>
                    {l}
                  </button>
                ))}
              </div>
              {typeof showAddPanel==='string' && (
                <>
                  <div style={{fontSize:10,color:C.slate,marginBottom:6}}>常用套话（点一下直接加）</div>
                  <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                    {phrases.map(p=>(
                      <button key={p} onClick={()=>addSticker(showAddPanel,p)}
                        style={{padding:'4px 10px',borderRadius:14,border:`1px solid ${C.slate}30`,
                          background:'#fff',color:C.navy,fontSize:11,cursor:'pointer'}}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    <input id="custom-phrase-input" style={{...S.inp,flex:1}} placeholder="或者自己打一句"
                      onKeyDown={e=>{ if(e.key==='Enter'){ addSticker(showAddPanel, e.target.value); e.target.value='' } }}/>
                    <button onClick={()=>{
                        const el=document.getElementById('custom-phrase-input')
                        addSticker(showAddPanel, el.value); el.value=''
                      }}
                      style={{...S.btn(C.green,false,true)}}>加</button>
                  </div>
                </>
              )}
            </div>
          )}

          {selectedLayer && (
            <div style={{marginTop:12,padding:'10px 12px',background:C.cream,borderRadius:10}}>
              <div style={{fontSize:11,fontWeight:700,color:C.navy,marginBottom:8}}>
                {selectedLayer.type==='image' ? '📷 商品图片'
                 : selectedLayer.type==='banner' ? '🎗 促销横幅'
                 : selectedLayer.type==='medal' ? '🥇 角标勋章'
                 : selectedLayer.type==='badge' ? '💬 卖点气泡' : '🔤 文字'}
              </div>

              {selectedLayer.type !== 'image' && (
                <div style={{marginBottom:8}}>
                  <label style={S.lbl}>内容{selectedLayer.text?.includes('\n') ? '（换行分隔中英文）':''}</label>
                  <textarea style={{...S.inp,minHeight:selectedLayer.text?.includes('\n')?56:36}} value={selectedLayer.text}
                    onChange={e=>updateSelected({text:e.target.value})}/>
                </div>
              )}

              {selectedLayer.type === 'image' ? (
                <div style={{marginBottom:8}}>
                  <label style={S.lbl}>图片大小</label>
                  <input type="range" min={CANVAS_SIZE*0.25} max={CANVAS_SIZE*0.95} value={selectedLayer.w}
                    style={{width:'100%'}} onChange={e=>{const v=+e.target.value; updateSelected({w:v,h:v})}}/>
                </div>
              ) : selectedLayer.type === 'medal' ? (
                <div style={{marginBottom:8}}>
                  <label style={S.lbl}>勋章大小</label>
                  <input type="range" min={30*SCALE} max={140*SCALE} value={selectedLayer.r}
                    style={{width:'100%'}} onChange={e=>updateSelected({r:+e.target.value})}/>
                </div>
              ) : (
                <div style={{marginBottom:8}}>
                  <label style={S.lbl}>字体大小</label>
                  <input type="range" min={12*SCALE} max={64*SCALE} value={selectedLayer.fontSize}
                    style={{width:'100%'}} onChange={e=>updateSelected({fontSize:+e.target.value})}/>
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

              {(selectedLayer.type === 'badge' || selectedLayer.type==='banner' || selectedLayer.type==='medal') && (
                <>
                  <div style={{marginBottom:8}}>
                    <label style={S.lbl}>底色</label>
                    <div style={{display:'flex',gap:6}}>
                      {BADGE_COLORS.map(c=>(
                        <div key={c} onClick={()=>updateSelected({bg:c})}
                          style={{width:26,height:26,borderRadius:13,background:c,cursor:'pointer',
                                 border:selectedLayer.bg===c?`2px solid ${C.navy}`:'2px solid transparent'}}/>
                      ))}
                    </div>
                  </div>
                  <button onClick={deleteSelected} style={{...S.btn(C.red,true,true)}}>🗑 删除这个贴纸</button>
                </>
              )}
            </div>
          )}

          <button onClick={handleDownload} style={{...S.btn(C.green),marginTop:14}}>
            💾 下载营销图（{CANVAS_SIZE}×{CANVAS_SIZE} 高清）
          </button>
        </div>
      )}
    </div>
  )
}
