// src/pages/ImportPage.jsx
import { useState } from 'react'
import { C, S } from '../App'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

// ── Categories ────────────────────────────────────────────────
const CATEGORIES = {
  '维他命/保健品': ['vitamin','dhc','supplement','lutein','omega','collagen','probiotic',
                   'calcium','iron','coenzyme','spirulina','glucosamine','biotin','melatonin',
                   'profertil','zinc','blueberry','taurine','quercetin','fish oil','folic'],
  '护肤/美容':    ['serum','cream','lotion','toner','sunscreen','whitening','hada labo',
                   'biore','skincare','mask','facial','cleanser','spf','uv','beauty',
                   'ceramide','retinol','moistur'],
  '个人护理':     ['shampoo','conditioner','hair','dental','oral','body wash','deodorant',
                   'feminine','razor','shave'],
  '厨房/家居':    ['bottle','flask','thermos','kitchen','cookware','storage','container',
                   'bialetti','coffee','moka','pot','jar'],
  '母婴/儿童':    ['baby','kids','child','infant','toddler','tomica','toy','puzzle'],
  '健康/医疗':    ['mosquito','repellent','pain','relief','bandage','plaster','sanitizer'],
  '食品/饮料':    ['food','snack','drink','tea','chocolate','candy','noodle','sauce'],
  '文具/办公':    ['pen','pencil','notebook','stationery','tape','scissor'],
  '运动/户外':    ['sport','exercise','gym','yoga','outdoor','hiking','fitness'],
  '电子/配件':    ['usb','cable','charger','phone','earphone','bluetooth','battery'],
  '日本进口':     ['japan','japanese','nippon','tomica','made in japan'],
}
const getCategory = name => {
  const t = (name||'').toLowerCase()
  for (const [cat,kws] of Object.entries(CATEGORIES))
    if (kws.some(k=>t.includes(k))) return cat
  return '其他'
}
const cleanName = n => (n||'').replace(/【.*?】/g,'').trim().slice(0,120)
const safeSku   = s => (s||'').replace(/[^a-zA-Z0-9\-_]/g,'').slice(0,50)

// ── Read xlsx ─────────────────────────────────────────────────
function readXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload  = e => {
      try {
        const wb  = XLSX.read(new Uint8Array(e.target.result), { type:'array' })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })
        let headerIdx = -1
        for (let i=0; i<Math.min(raw.length,10); i++) {
          if (raw[i].some(c=>String(c).trim()==='Product ID')) { headerIdx=i; break }
        }
        if (headerIdx<0) { resolve([]); return }
        const headers = raw[headerIdx].map(h=>String(h||'').trim())
        const rows = []
        for (let i=headerIdx+3; i<raw.length; i++) {
          const r = raw[i]
          const pid = String(r[0]||'').trim()
          if (!pid || !/^\d+$/.test(pid)) continue
          const obj = {}
          headers.forEach((h,j)=>{ obj[h]=String(r[j]!==undefined?r[j]:'').trim() })
          rows.push(obj)
        }
        resolve(rows)
      } catch(err) { reject(err) }
    }
    reader.readAsArrayBuffer(file)
  })
}

// ── Parse products from Excel rows ────────────────────────────
function parseProducts(salesRows, mediaRows, platform) {
  const isShopee = platform.startsWith('Shopee')
  const isMY     = platform.includes('MY')
  const currency = isMY ? 'RM' : 'SGD'
  const prefix   = isShopee ? (isMY?'SHPMY':'SHPSG') : (isMY?'LZMY':'LZSG')
  const batchTag = `LOT-${prefix}-IMPORT`

  const mediaMap = {}
  mediaRows.forEach(r => {
    if (r['Product ID']) mediaMap[r['Product ID']] = r['Cover image']||r['Product Images1']||''
    if (r['SellerSKU'])  mediaMap[`sku:${r['SellerSKU']}`] = r['Images1']||''
  })

  const groups = {}
  salesRows.forEach(r => {
    const pid=r['Product ID']; if (!pid) return
    if (!groups[pid]) groups[pid]=[]
    groups[pid].push(r)
  })

  const seenSkus = {}
  // SKU always includes platform prefix to avoid cross-platform collisions
  // e.g. Lazada SG "FullLeg-L" → "LZSG-FullLeg-L"
  //      Lazada MY "FullLeg-L" → "LZMY-FullLeg-L"
  const makeSku = (rawSku, fallback) => {
    const base = rawSku ? `${prefix}-${safeSku(rawSku)}` : fallback
    if (!seenSkus[base]) { seenSkus[base]=0; return base }
    return `${base}-${++seenSkus[base]}`
  }

  const products=[], batches=[]
  const today = new Date().toISOString().split('T')[0]

  Object.entries(groups).forEach(([pid,variants]) => {
    const first=variants[0]
    const rawName=first['Product Name']||''
    const name=cleanName(rawName)
    const cat=getCategory(rawName)
    const cover=mediaMap[pid]||''
    if (!name) return

    const isNoVar = variants.length===1 && !first['Variation Name'] && !first['Variations Combo']

    if (isNoVar) {
      const v=variants[0]
      const rawSku=v['SKU']||v['SellerSKU']||''
      const sku=makeSku(rawSku, `${prefix}-${pid.slice(-10)}`)
      const qty=parseInt(v['Stock']||v['Quantity']||'0')||0
      const price=parseFloat(v['Price']||'0')||0
      const img=mediaMap[`sku:${rawSku}`]||cover
      const vid=crypto.randomUUID()
      products.push({
        id:vid, parent_id:null, name, variant_name:null, sku,
        cost:parseFloat((price*0.5).toFixed(2)), price,
        shopee_sku:isShopee?rawSku:null, lazada_sku:!isShopee?rawSku:null,
        min_stock:30, reorder_days:30, has_expiry:false,
        platform, category:cat, photo_url:img||null
      })
      if (qty>0) batches.push({
        id:crypto.randomUUID(), product_id:vid,
        batch_no:batchTag, qty, received_date:today,
        expiry_date:null, cost:parseFloat((price*0.5).toFixed(2))
      })
    } else {
      const parentId=crypto.randomUUID()
      const psku=makeSku('', `${prefix}-${pid.slice(-10)}-P`)
      products.push({
        id:parentId, parent_id:null, name, variant_name:null, sku:psku,
        cost:0, price:0,
        shopee_sku:isShopee?pid:null, lazada_sku:!isShopee?pid:null,
        min_stock:30, reorder_days:30, has_expiry:false,
        platform, category:cat, photo_url:cover||null
      })
      variants.forEach((v,i) => {
        const vid=crypto.randomUUID()
        const vname=(v['Variation Name']||v['Variations Combo']||`Variant ${i+1}`).slice(0,80)
        const rawSku=v['SKU']||v['SellerSKU']||''
        const vsku=makeSku(rawSku, `${prefix}-${pid.slice(-10)}-V${i}`)
        const qty=parseInt(v['Stock']||v['Quantity']||'0')||0
        const price=parseFloat(v['Price']||'0')||0
        const vimg=mediaMap[`sku:${rawSku}`]||cover
        products.push({
          id:vid, parent_id:parentId, name, variant_name:vname, sku:vsku,
          cost:parseFloat((price*0.5).toFixed(2)), price,
          shopee_sku:isShopee?rawSku:null, lazada_sku:!isShopee?rawSku:null,
          min_stock:30, reorder_days:30, has_expiry:false,
          platform, category:cat, photo_url:vimg||null
        })
        if (qty>0) batches.push({
          id:crypto.randomUUID(), product_id:vid,
          batch_no:batchTag, qty, received_date:today,
          expiry_date:null, cost:parseFloat((price*0.5).toFixed(2))
        })
      })
    }
  })
  return { products, batches, currency }
}

// ── Check duplicates against DB ───────────────────────────────
// Since SKUs now include platform prefix (e.g. LZMY-xxx vs LZSG-xxx),
// same raw SKU on different platforms will have different DB SKUs
// So a simple SKU match is now correct and platform-safe
async function checkDuplicates(products) {
  const skus = products.map(p=>p.sku).filter(Boolean)
  const CHUNK = 100
  const existing = []
  for (let i=0; i<skus.length; i+=CHUNK) {
    const { data } = await supabase
      .from('products')
      .select('id, sku, name, variant_name, platform, price, cost')
      .in('sku', skus.slice(i, i+CHUNK))
    if (data) existing.push(...data)
  }
  return existing
}

// ── Upload to Supabase ────────────────────────────────────────
// dupAction: 'skip'（跳过重复，只新增全新产品，重复产品的资料和库存都不动）
//          | 'overwrite'（覆盖重复产品的资料，但库存不动——不会重复累加库存）
//          | 'overwrite_stock'（覆盖资料 + 库存数量校正为 Excel 上的数字，
//                                会先清空该产品的旧库存批次，再按 Excel 数字建一笔新的）
// 全新产品（不管选哪个模式）都会正常写入库存批次，因为它们没有旧数据需要顾虑
async function doUpload(products, batches, dupAction, dupSkus, onProgress) {
  const CHUNK = 50
  let inserted=0, updated=0, batchOk=0, stockCorrected=0
  const errors=[]
  const dupSkuSet = new Set(dupSkus||[])

  onProgress('上传产品中…')

  if (dupAction === 'overwrite' || dupAction === 'overwrite_stock') {
    // upsert all（覆盖重复产品的资料）
    for (let i=0; i<products.length; i+=CHUNK) {
      const chunk = products.slice(i,i+CHUNK)
      onProgress(`覆盖产品 ${i+1}–${Math.min(i+CHUNK,products.length)} / ${products.length}`)
      const { error } = await supabase.from('products')
        .upsert(chunk, { onConflict:'sku' })
      if (error) errors.push(error.message)
      else updated += chunk.length
    }
  } else {
    // insert only, skip duplicates
    for (let i=0; i<products.length; i+=CHUNK) {
      const chunk = products.slice(i,i+CHUNK)
      onProgress(`新增产品 ${i+1}–${Math.min(i+CHUNK,products.length)} / ${products.length}`)
      const { error } = await supabase.from('products')
        .upsert(chunk, { onConflict:'sku', ignoreDuplicates:true })
      if (error) errors.push(error.message)
      else inserted += chunk.length
    }
  }

  if (errors.length>0) return { inserted, updated, skipped:0, batchOk, stockCorrected, errors }

  // Re-fetch inserted IDs by SKU to correctly link batches
  onProgress('验证产品 ID，准备写入库存…')
  const batchSkus = [...new Set(batches.map(b => {
    const p = products.find(x=>x.id===b.product_id)
    return p?.sku
  }).filter(Boolean))]

  const skuToId = {}
  for (let i=0; i<batchSkus.length; i+=100) {
    const { data } = await supabase.from('products').select('id,sku')
      .in('sku', batchSkus.slice(i,i+100))
    ;(data||[]).forEach(p => { skuToId[p.sku]=p.id })
  }

  const remapped = batches.map(b => {
    const p = products.find(x=>x.id===b.product_id)
    const dbId = p ? skuToId[p.sku] : null
    return dbId ? {...b, product_id:dbId, _sku:p.sku} : null
  }).filter(Boolean)

  // 重复 SKU 对应的产品 id（用来判断哪些批次属于"已存在的产品"）
  const dupProductIds = new Set(
    remapped.filter(b => dupSkuSet.has(b._sku)).map(b => b.product_id)
  )

  if (dupAction === 'overwrite_stock' && dupProductIds.size > 0) {
    onProgress('清空重复产品的旧库存批次，准备用 Excel 数字校正…')
    const { error } = await supabase.from('batches').delete().in('product_id', [...dupProductIds])
    if (error) errors.push('清空旧批次失败：'+error.message)
    stockCorrected = dupProductIds.size
  }

  // 决定哪些批次真的要插入：
  // - overwrite_stock：全部批次都插（新产品 + 已清空、要校正的重复产品）
  // - overwrite / skip：只插"全新产品"的批次，重复产品的库存维持原样，不重复累加
  const batchesToInsert = (dupAction === 'overwrite_stock')
    ? remapped
    : remapped.filter(b => !dupProductIds.has(b.product_id))

  const cleanBatches = batchesToInsert.map(({_sku, ...rest}) => rest)

  for (let i=0; i<cleanBatches.length; i+=CHUNK) {
    const chunk = cleanBatches.slice(i,i+CHUNK)
    onProgress(`写入库存批次 ${i+1}–${Math.min(i+CHUNK,cleanBatches.length)} / ${cleanBatches.length}`)
    const { error } = await supabase.from('batches').insert(chunk)
    if (error) errors.push('批次错误：'+error.message)
    else batchOk += chunk.length
  }

  return { inserted, updated, skipped:0, batchOk, stockCorrected, errors }
}

// ════════════════════════════════════════════════════════════════
export default function ImportPage({ shout, refetch }) {
  const [platform,  setPlatform]  = useState('Shopee MY')
  const [salesFile, setSalesFile] = useState(null)
  const [mediaFile, setMediaFile] = useState(null)
  // steps: upload → checking → conflict → uploading → done
  const [step,      setStep]      = useState('upload')
  const [parsed,    setParsed]    = useState(null)       // {products, batches, currency}
  const [dupInfo,   setDupInfo]   = useState(null)       // {duplicates[], newCount}
  const [dupAction, setDupAction] = useState(null)       // 'skip'|'overwrite'|'overwrite_stock'
  const [progress,  setProgress]  = useState('')
  const [uploadRes, setUploadRes] = useState(null)
  const [logs,      setLogs]      = useState([])

  const isShopee = platform.startsWith('Shopee')
  const addLog   = msg => setLogs(p=>[...p,msg])

  const reset = () => {
    setSalesFile(null); setMediaFile(null); setParsed(null)
    setDupInfo(null); setDupAction(null); setStep('upload')
    setLogs([]); setUploadRes(null)
  }

  // ── Step 1: Parse + check duplicates ──────────────────────
  const handleParse = async () => {
    if (!salesFile) { shout('请先上传主文件',true); return }
    setLogs([]); setStep('checking')
    try {
      addLog('读取 Excel 文件…')
      const salesRows = await readXlsx(salesFile)
      const mediaRows = mediaFile ? await readXlsx(mediaFile) : []
      addLog(`解析到 ${salesRows.length} 行产品，${mediaRows.length} 行图片`)

      if (salesRows.length===0) {
        addLog('❌ 无法读取产品数据，请确认文件格式')
        shout('无法读取数据',true); setStep('upload'); return
      }
      addLog(`字段：${Object.keys(salesRows[0]).slice(0,5).join(' | ')}`)

      addLog('解析产品结构…')
      const result = parseProducts(salesRows, mediaRows, platform)
      addLog(`✅ 解析完成：${result.products.length} 个产品/变体，${result.batches.length} 笔库存`)

      addLog('检查数据库是否有重复 SKU…')
      const existingRows = await checkDuplicates(result.products)
      addLog(existingRows.length>0
        ? `⚠️ 发现 ${existingRows.length} 个 SKU 已存在于数据库`
        : '✅ 没有重复 SKU，全部可以新增')

      const dupSkus = new Set(existingRows.map(r=>r.sku))
      const newProducts = result.products.filter(p=>!dupSkus.has(p.sku))

      setParsed(result)
      setDupInfo({ duplicates:existingRows, newCount:newProducts.length })
      setStep('conflict')
    } catch(e) {
      addLog(`❌ ${e.message}`)
      shout('解析失败：'+e.message,true)
      setStep('upload')
    }
  }

  // ── Step 2: Upload with chosen action ─────────────────────
  const handleUpload = async () => {
    if (!parsed) return
    if (dupInfo && dupInfo.duplicates.length>0 && !dupAction) return
    setStep('uploading')
    try {
      const dupSkus = (dupInfo?.duplicates||[]).map(d=>d.sku)
      const res = await doUpload(parsed.products, parsed.batches, dupAction, dupSkus, setProgress)
      setUploadRes(res)
      setStep('done')
      if (res.errors.length===0) {
        shout(`✅ 上传成功！产品已写入数据库`)
        refetch && refetch()
      } else {
        shout(`上传完成，有 ${res.errors.length} 个错误`,true)
      }
    } catch(e) {
      shout('上传失败：'+e.message,true)
      setStep('conflict')
    }
  }

  const totalStock = parsed?.batches.reduce((s,b)=>s+b.qty,0)||0

  return (
    <div>
      {/* Header + step bar */}
      <div style={{...S.card,background:C.navy}}>
        <div style={{color:C.orange,fontWeight:700,fontSize:15,marginBottom:4}}>
          📥 Excel 导入工具
        </div>
        <div style={{color:C.slateLight,fontSize:11,lineHeight:1.6,marginBottom:10}}>
          上传 Excel → 解析 → 检查重复 → 选择处理方式 → 写入数据库
        </div>
        {/* Step indicator */}
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          {[
            ['upload',   '上传'],
            ['checking', '解析检查'],
            ['conflict', '重复处理'],
            ['uploading','写入'],
            ['done',     '完成'],
          ].map(([id,label],i)=>{
            const steps=['upload','checking','conflict','uploading','done']
            const curIdx=steps.indexOf(step)
            const thisIdx=steps.indexOf(id)
            const isDone=curIdx>thisIdx
            const isActive=curIdx===thisIdx
            return (
              <div key={id} style={{display:'flex',alignItems:'center',gap:3}}>
                <div style={{width:18,height:18,borderRadius:'50%',fontSize:9,fontWeight:700,
                  display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
                  background:isDone?C.green:isActive?C.orange:C.navyMid,color:'#fff'}}>
                  {isDone?'✓':i+1}
                </div>
                <span style={{fontSize:9,color:isActive?C.orange:isDone?C.green:C.slateLight,
                  whiteSpace:'nowrap'}}>{label}</span>
                {i<4&&<div style={{width:12,height:1,background:C.navyMid,flexShrink:0}}/>}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── UPLOAD ───────────────────────────────────────────── */}
      {(step==='upload'||step==='checking') && (
        <div style={S.card}>
          <div style={S.secTitle}>选择平台</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
            {['Shopee MY','Shopee SG','Lazada MY','Lazada SG'].map(p=>(
              <button key={p} onClick={()=>{setPlatform(p);reset()}}
                style={{padding:'7px 14px',borderRadius:20,border:'none',cursor:'pointer',
                  background:platform===p?C.orange:C.cream,
                  color:platform===p?'#fff':C.slate,
                  fontWeight:platform===p?700:400,fontSize:12}}>
                {p} <span style={{fontSize:10,opacity:.7}}>({p.includes('MY')?'RM':'SGD'})</span>
              </button>
            ))}
          </div>

          {[
            {
              key:'sales', file:salesFile, set:setSalesFile, required:true,
              label:isShopee?'Sales Info / Inventory Info Excel *':'Price & Stock Excel *',
              desc:isShopee
                ?'Seller Centre → Batch Tools → Mass Update → Sales Info 或 Inventory Info'
                :'Seller Centre → Manage Products → Export → pricestock',
            },
            {
              key:'media', file:mediaFile, set:setMediaFile, required:false,
              label:isShopee?'Media Info（选填，含图片链接）':'Basic Info（选填，含图片）',
              desc:isShopee?'Mass Update → Media Info':'Manage Products → Export → basic',
            },
          ].map(({key,file,set,required,label,desc})=>(
            <div key={key} style={{marginBottom:12}}>
              <label style={{...S.lbl,fontSize:12}}>
                {label}{!required&&<span style={{color:C.slateLight,fontWeight:400}}> (选填)</span>}
              </label>
              <div style={{fontSize:10,color:C.slateLight,marginBottom:5}}>{desc}</div>
              <label style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',
                borderRadius:8,cursor:'pointer',
                border:`1.5px dashed ${file?C.green:C.slateLight}60`,
                background:file?C.green+'08':C.cream}}>
                <span style={{fontSize:20}}>{file?'✅':'📄'}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:file?C.green:C.slate}}>
                    {file?file.name:'点击选择 .xlsx 文件'}
                  </div>
                  {file&&<div style={{fontSize:10,color:C.slate}}>{(file.size/1024).toFixed(0)} KB</div>}
                </div>
                <input type="file" accept=".xlsx,.xls" style={{display:'none'}}
                  onChange={e=>{set(e.target.files[0]);setParsed(null);setDupInfo(null);setStep('upload');setLogs([])}}/>
              </label>
            </div>
          ))}

          <button onClick={handleParse} disabled={!salesFile||step==='checking'}
            style={{...S.btn(!salesFile||step==='checking'?C.slateLight:C.orange),
                    opacity:salesFile&&step!=='checking'?1:0.5}}>
            {step==='checking'?'⏳ 解析检查中…':'🔍 解析并检查重复'}
          </button>

          {logs.length>0&&(
            <div style={{marginTop:10,background:C.navyLight,borderRadius:8,padding:'10px 12px'}}>
              {logs.map((l,i)=>(
                <div key={i} style={{fontSize:11,marginBottom:2,
                  color:l.startsWith('✅')?C.green:l.startsWith('❌')?C.red:
                        l.startsWith('⚠')?C.yellow:C.slateLight}}>
                  {l}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CONFLICT RESOLUTION ───────────────────────────────── */}
      {step==='conflict' && parsed && dupInfo && (
        <div>
          {/* Summary */}
          <div style={{...S.card,background:C.navy}}>
            <div style={{color:C.orange,fontWeight:700,fontSize:14,marginBottom:10}}>
              📊 解析结果
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[
                [parsed.products.length,   '总产品/变体',   C.orange],
                [dupInfo.newCount,          '新产品（可新增）',C.green],
                [dupInfo.duplicates.length, '重复 SKU（已存在）',dupInfo.duplicates.length>0?C.yellow:C.green],
                [totalStock,               '总库存件数',    C.blue],
              ].map(([v,l,col])=>(
                <div key={l} style={{background:C.navyMid,borderRadius:8,padding:'8px 10px'}}>
                  <div style={{fontSize:20,fontWeight:900,color:col}}>{v}</div>
                  <div style={{fontSize:10,color:C.slateLight,lineHeight:1.3}}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Duplicate list */}
          {dupInfo.duplicates.length>0 && (
            <div style={S.card}>
              <div style={{...S.secTitle,color:C.yellow}}>
                ⚠️ {dupInfo.duplicates.length} 个 SKU 已存在于数据库
              </div>
              <div style={{fontSize:11,color:C.slate,marginBottom:10}}>
                以下产品的 SKU 在数据库里已有记录，请选择处理方式：
              </div>

              {/* Duplicate list preview */}
              <div style={{background:C.cream,borderRadius:8,padding:'8px',marginBottom:12,
                           maxHeight:220,overflowY:'auto'}}>
                {dupInfo.duplicates.map((ex,i)=>{
                  const incoming = parsed.products.find(p=>p.sku===ex.sku)
                  return (
                    <div key={i} style={{paddingBottom:8,marginBottom:8,
                      borderBottom:i<dupInfo.duplicates.length-1?`1px solid #e0e0e0`:'none'}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4}}>
                        {/* DB version */}
                        <div style={{background:'#fff',borderRadius:6,padding:'6px 8px',
                                     border:`1px solid ${C.slateLight}30`}}>
                          <div style={{fontSize:9,color:C.slate,marginBottom:2,fontWeight:700}}>
                            📦 数据库现有
                          </div>
                          <div style={{fontSize:11,fontWeight:600,lineHeight:1.3}}>{ex.name}{ex.variant_name?` · ${ex.variant_name}`:''}</div>
                          <div style={{fontSize:10,color:C.slate,fontFamily:'monospace'}}>{ex.sku}</div>
                          <div style={{fontSize:10,color:C.blue}}>
                            {ex.platform} · 售价 {ex.price} · 成本 {ex.cost}
                          </div>
                        </div>
                        {/* Incoming version */}
                        <div style={{background:'#fff',borderRadius:6,padding:'6px 8px',
                                     border:`1px solid ${C.orange}40`}}>
                          <div style={{fontSize:9,color:C.orange,marginBottom:2,fontWeight:700}}>
                            📥 Excel 新数据
                          </div>
                          <div style={{fontSize:11,fontWeight:600,lineHeight:1.3}}>{incoming?.name}{incoming?.variant_name?` · ${incoming.variant_name}`:''}</div>
                          <div style={{fontSize:10,color:C.slate,fontFamily:'monospace'}}>{incoming?.sku}</div>
                          <div style={{fontSize:10,color:C.orange}}>
                            {incoming?.platform} · 售价 {incoming?.price} · 成本 {incoming?.cost}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Action choice */}
              <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:8}}>
                对于重复 SKU，你想要：
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <button onClick={()=>setDupAction('skip')}
                  style={{padding:'12px 16px',borderRadius:10,border:`2px solid ${dupAction==='skip'?C.blue:C.slateLight+'40'}`,
                    background:dupAction==='skip'?C.blue+'10':'#fff',cursor:'pointer',textAlign:'left'}}>
                  <div style={{fontWeight:700,fontSize:13,color:dupAction==='skip'?C.blue:C.navy}}>
                    ⏭ 跳过重复，只新增 {dupInfo.newCount} 个新产品
                  </div>
                  <div style={{fontSize:11,color:C.slate,marginTop:3}}>
                    重复的 SKU 完全不动（资料、库存都保持原样）
                  </div>
                </button>
                <button onClick={()=>setDupAction('overwrite')}
                  style={{padding:'12px 16px',borderRadius:10,border:`2px solid ${dupAction==='overwrite'?C.orange:C.slateLight+'40'}`,
                    background:dupAction==='overwrite'?C.orange+'10':'#fff',cursor:'pointer',textAlign:'left'}}>
                  <div style={{fontWeight:700,fontSize:13,color:dupAction==='overwrite'?C.orange:C.navy}}>
                    🔄 只覆盖产品资料 {parsed.products.length} 个产品（库存不动）
                  </div>
                  <div style={{fontSize:11,color:C.slate,marginTop:3}}>
                    更新名称、价格、图片等，<b>库存数量维持原样、不会重复累加</b>
                    <br/>⚠️ 注意：会覆盖你手动修改过的成本
                  </div>
                </button>
                <button onClick={()=>setDupAction('overwrite_stock')}
                  style={{padding:'12px 16px',borderRadius:10,border:`2px solid ${dupAction==='overwrite_stock'?C.red:C.slateLight+'40'}`,
                    background:dupAction==='overwrite_stock'?C.red+'10':'#fff',cursor:'pointer',textAlign:'left'}}>
                  <div style={{fontWeight:700,fontSize:13,color:dupAction==='overwrite_stock'?C.red:C.navy}}>
                    🔁 完全覆盖（含库存数量校正）
                  </div>
                  <div style={{fontSize:11,color:C.slate,marginTop:3}}>
                    覆盖产品资料 + <b>把库存数量校正成 Excel 上的数字</b>（先清空旧库存批次，再按 Excel 重建）
                    <br/>⚠️ 适合"以平台后台数据为准"的情况；如果这段时间在 StockEasy 里手动调整过库存，会被 Excel 的数字取代
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* No duplicates */}
          {dupInfo.duplicates.length===0 && (
            <div style={{...S.card,border:`2px solid ${C.green}`,background:C.green+'08'}}>
              <div style={{color:C.green,fontWeight:700,fontSize:14,marginBottom:4}}>
                ✅ 没有重复 SKU
              </div>
              <div style={{fontSize:12,color:C.slate}}>
                全部 {parsed.products.length} 个产品都是新的，可以直接写入。
              </div>
            </div>
          )}

          {/* Notes */}
          <div style={{...S.card,background:C.cream}}>
            <div style={{fontSize:11,color:C.slate,lineHeight:1.9}}>
              📌 成本暂用售价 50%，上传后请在产品页更新实际成本<br/>
              📌 图片来自平台 CDN，产品下架后可能失效<br/>
              📌 库存批次只针对有库存的产品写入
            </div>
          </div>

          {/* Action buttons */}
          <div style={{display:'flex',gap:8}}>
            <button onClick={reset} style={S.btn(C.slate,false)}>← 重新上传</button>
            <button
              onClick={handleUpload}
              disabled={dupInfo.duplicates.length>0 && !dupAction}
              style={{...S.btn(
                dupInfo.duplicates.length===0||dupAction===undefined
                  ? (dupAction||dupInfo.duplicates.length===0?C.green:C.slateLight)
                  : dupAction?C.green:C.slateLight
              ),flex:1,
                opacity:dupInfo.duplicates.length===0||dupAction?1:0.4}}>
              {dupAction==='overwrite_stock'
                ? `🔁 完全覆盖并校正库存（${parsed.products.length} 个产品）`
                : dupAction==='overwrite'
                ? `🔄 覆盖资料并写入 ${parsed.products.length} 个产品`
                : dupAction==='skip'
                ? `✅ 只写入 ${dupInfo.newCount} 个新产品`
                : dupInfo.duplicates.length===0
                ? `✅ 写入 ${parsed.products.length} 个产品`
                : '请先选择重复处理方式'}
            </button>
          </div>
        </div>
      )}

      {/* ── UPLOADING ─────────────────────────────────────────── */}
      {step==='uploading' && (
        <div style={{...S.card,textAlign:'center',padding:'40px 20px'}}>
          <div style={{fontSize:36,marginBottom:12}}>⏳</div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>写入数据库中…</div>
          <div style={{fontSize:12,color:C.slate,marginBottom:16}}>{progress}</div>
          <div style={{height:4,background:C.cream,borderRadius:2,overflow:'hidden'}}>
            <div style={{height:'100%',background:C.orange,width:'60%',
              animation:'ldbar 1.5s ease-in-out infinite'}}/>
          </div>
          <style>{`@keyframes ldbar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}`}</style>
        </div>
      )}

      {/* ── DONE ──────────────────────────────────────────────── */}
      {step==='done' && uploadRes && (
        <div>
          <div style={{...S.card,
            border:`2px solid ${uploadRes.errors.length===0?C.green:C.yellow}`,
            background:uploadRes.errors.length===0?C.green+'08':C.yellow+'08'}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:12,
              color:uploadRes.errors.length===0?C.green:C.yellow}}>
              {uploadRes.errors.length===0?'🎉 上传成功！':'⚠️ 完成（有部分错误）'}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
              {[
                [uploadRes.inserted||uploadRes.updated,'已写入产品',C.green],
                [uploadRes.batchOk,                   '已写入库存批次',C.green],
                [dupInfo?.duplicates.length||0,       '重复SKU',uploadRes.updated>0?C.orange:C.slate],
                [uploadRes.errors.length,             '错误数',uploadRes.errors.length>0?C.red:C.green],
              ].map(([v,l,col])=>(
                <div key={l} style={{background:'#fff',borderRadius:8,padding:'8px 10px'}}>
                  <div style={{fontSize:18,fontWeight:900,color:col}}>{v}</div>
                  <div style={{fontSize:10,color:C.slate}}>{l}</div>
                </div>
              ))}
            </div>
            {uploadRes.stockCorrected>0 && (
              <div style={{fontSize:11,color:C.red,marginBottom:8}}>
                🔁 {uploadRes.stockCorrected} 个重复产品的库存已用 Excel 数字校正（旧批次已清空重建）
              </div>
            )}
            {uploadRes.errors.slice(0,5).map((e,i)=>(
              <div key={i} style={{fontSize:11,color:C.red,marginBottom:4,
                padding:'6px 10px',background:C.red+'10',borderRadius:6}}>❌ {e}</div>
            ))}
            <div style={{fontSize:11,color:C.slate,marginTop:8,lineHeight:1.8}}>
              ✅ 请到「产品」页更新实际成本<br/>
              ✅ 库存已写入批次记录，可在扫码页查看
            </div>
          </div>
          <button onClick={reset} style={S.btn()}>📥 导入其他平台</button>
        </div>
      )}
    </div>
