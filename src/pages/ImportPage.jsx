// src/pages/ImportPage.jsx
// Upload Excel → Parse → Preview & Validate → Direct insert to Supabase
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
    if (kws.some(k => t.includes(k))) return cat
  return '其他'
}
const cleanName = n => (n||'').replace(/【.*?】/g,'').trim().slice(0,120)
const safeSku   = s => (s||'').replace(/[^a-zA-Z0-9\-_]/g,'').slice(0,50)

// ── Read xlsx → rows ──────────────────────────────────────────
function readXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload  = e => {
      try {
        const wb  = XLSX.read(new Uint8Array(e.target.result), { type:'array' })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })

        // Auto-detect header row (first row containing "Product ID")
        let headerIdx = -1
        for (let i = 0; i < Math.min(raw.length, 10); i++) {
          if (raw[i].some(c => String(c).trim() === 'Product ID')) {
            headerIdx = i; break
          }
        }
        if (headerIdx < 0) { resolve([]); return }

        const headers = raw[headerIdx].map(h => String(h||'').trim())
        const rows = []
        // Skip header + mandatory + blank rows (usually 3 rows)
        for (let i = headerIdx + 3; i < raw.length; i++) {
          const r = raw[i]
          const pid = String(r[0]||'').trim()
          if (!pid || !/^\d+$/.test(pid)) continue
          const obj = {}
          headers.forEach((h,j) => { obj[h] = String(r[j] !== undefined ? r[j] : '').trim() })
          rows.push(obj)
        }
        resolve(rows)
      } catch(err) { reject(err) }
    }
    reader.readAsArrayBuffer(file)
  })
}

// ── Parse into product + batch records ───────────────────────
function parseProducts(salesRows, mediaRows, platform) {
  const isShopee = platform.startsWith('Shopee')
  const isMY     = platform.includes('MY')
  const currency = isMY ? 'RM' : 'SGD'
  const prefix   = isShopee ? (isMY?'SHPMY':'SHPSG') : (isMY?'LZMY':'LZSG')
  const batchTag = `LOT-${prefix}-IMPORT`

  // Media map
  const mediaMap = {}
  mediaRows.forEach(r => {
    if (r['Product ID']) mediaMap[r['Product ID']] = r['Cover image'] || r['Product Images1'] || ''
    if (r['SellerSKU'])  mediaMap[`sku:${r['SellerSKU']}`] = r['Images1'] || ''
  })

  // Group by Product ID
  const groups = {}
  salesRows.forEach(r => {
    const pid = r['Product ID']; if (!pid) return
    if (!groups[pid]) groups[pid] = []
    groups[pid].push(r)
  })

  const seenSkus = {}
  const dedupSku = sku => {
    if (!seenSkus[sku]) { seenSkus[sku]=0; return sku }
    return `${sku}-${++seenSkus[sku]}`
  }

  const products = []   // for Supabase products table
  const batches  = []   // for Supabase batches table
  const preview  = []   // for UI preview/validation
  const warnings = []   // validation warnings

  Object.entries(groups).forEach(([pid, variants]) => {
    const first   = variants[0]
    const rawName = first['Product Name'] || ''
    const name    = cleanName(rawName)
    const cat     = getCategory(rawName)
    const cover   = mediaMap[pid] || ''

    if (!name) { warnings.push(`Product ID ${pid}: 产品名称为空，已跳过`); return }

    const isNoVariant = variants.length === 1 &&
      !first['Variation Name'] && !first['Variations Combo']

    if (isNoVariant) {
      const v      = variants[0]
      const rawSku = v['SKU'] || v['SellerSKU'] || ''
      const sku    = dedupSku(safeSku(rawSku) || `${prefix}-${pid.slice(-10)}`)
      const qty    = parseInt(v['Stock']||v['Quantity']||'0')||0
      const price  = parseFloat(v['Price']||'0')||0
      const img    = mediaMap[`sku:${rawSku}`] || cover
      const vid    = crypto.randomUUID()

      if (!sku) { warnings.push(`${name}: SKU 为空，自动生成`); }

      products.push({
        id: vid, parent_id: null, name, variant_name: null, sku,
        cost: price*0.5, price,
        shopee_sku: isShopee ? rawSku : null,
        lazada_sku: !isShopee ? rawSku : null,
        min_stock: 30, reorder_days: 30, has_expiry: false,
        platform, category: cat, photo_url: img || null
      })
      if (qty > 0) batches.push({ id:crypto.randomUUID(), product_id:vid,
        batch_no:batchTag, qty, received_date:new Date().toISOString().split('T')[0],
        expiry_date:null, cost: parseFloat((price*0.5).toFixed(2)) })
      preview.push({ name, sku, price, qty, currency, img, cat, platform, isParent:false })

    } else {
      const parentId = crypto.randomUUID()
      const psku     = dedupSku(`${prefix}-${pid.slice(-10)}-P`)
      const img      = cover

      products.push({
        id: parentId, parent_id: null, name, variant_name: null, sku: psku,
        cost: 0, price: 0,
        shopee_sku: isShopee ? pid : null,
        lazada_sku: !isShopee ? pid : null,
        min_stock: 30, reorder_days: 30, has_expiry: false,
        platform, category: cat, photo_url: img || null
      })
      preview.push({ name, sku:psku, price:0, qty:0, currency, img, cat, platform, isParent:true, variantCount:variants.length })

      variants.forEach((v, i) => {
        const vid    = crypto.randomUUID()
        const vname  = (v['Variation Name']||v['Variations Combo']||`Variant ${i+1}`).slice(0,80)
        const rawSku = v['SKU']||v['SellerSKU']||''
        const vsku   = dedupSku(safeSku(rawSku)||`${prefix}-${pid.slice(-10)}-V${i}`)
        const qty    = parseInt(v['Stock']||v['Quantity']||'0')||0
        const price  = parseFloat(v['Price']||'0')||0
        const vimg   = mediaMap[`sku:${rawSku}`] || cover

        products.push({
          id: vid, parent_id: parentId, name, variant_name: vname, sku: vsku,
          cost: parseFloat((price*0.5).toFixed(2)), price,
          shopee_sku: isShopee ? rawSku : null,
          lazada_sku: !isShopee ? rawSku : null,
          min_stock: 30, reorder_days: 30, has_expiry: false,
          platform, category: cat, photo_url: vimg || null
        })
        if (qty > 0) batches.push({ id:crypto.randomUUID(), product_id:vid,
          batch_no:batchTag, qty, received_date:new Date().toISOString().split('T')[0],
          expiry_date:null, cost: parseFloat((price*0.5).toFixed(2)) })
        preview.push({ name:`${name} · ${vname}`, sku:vsku, price, qty, currency, img:vimg, cat, platform, isParent:false })
      })
    }
  })

  return { products, batches, preview, warnings, currency }
}

// ── Validation checks ─────────────────────────────────────────
function validate(products, batches) {
  const errors   = []
  const warnings = []
  const skus     = products.map(p => p.sku)
  const dupSkus  = skus.filter((s,i) => skus.indexOf(s) !== i)

  if (dupSkus.length > 0)
    errors.push(`重复 SKU：${[...new Set(dupSkus)].slice(0,5).join(', ')}`)
  if (products.some(p => !p.name || p.name.trim() === ''))
    errors.push('有产品名称为空')
  if (products.some(p => !p.sku || p.sku.trim() === ''))
    errors.push('有产品 SKU 为空')
  if (products.length === 0)
    errors.push('没有找到任何产品数据')

  const noPrice = products.filter(p => !p.parent_id && p.price === 0).length
  if (noPrice > 0)
    warnings.push(`${noPrice} 个产品价格为 0，请确认`)

  const noImg = products.filter(p => !p.photo_url).length
  if (noImg > 0)
    warnings.push(`${noImg} 个产品没有图片（请确认是否上传了 Media Info 文件）`)

  return { errors, warnings, valid: errors.length === 0 }
}

// ── Upload to Supabase ────────────────────────────────────────
async function uploadToSupabase(products, batches, onProgress) {
  const results = { inserted:0, skipped:0, batchOk:0, errors:[] }

  // Ensure columns exist
  onProgress('检查数据库栏位…')
  await supabase.rpc('exec_sql', {
    sql: `ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '其他';
          ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_url TEXT;`
  }).catch(() => {}) // ignore if rpc doesn't exist, columns may already exist

  // Insert products in chunks of 50
  const CHUNK = 50
  for (let i = 0; i < products.length; i += CHUNK) {
    const chunk = products.slice(i, i + CHUNK)
    onProgress(`上传产品 ${i+1}–${Math.min(i+CHUNK, products.length)} / ${products.length}…`)
    const { error, data } = await supabase
      .from('products')
      .upsert(chunk, { onConflict: 'sku', ignoreDuplicates: true })
    if (error) {
      results.errors.push(`产品批次 ${i/CHUNK+1} 错误：${error.message}`)
    } else {
      results.inserted += chunk.length
    }
  }

  if (results.errors.length > 0) return results

  // Get actual inserted product IDs to correctly link batches
  onProgress('验证产品 ID…')
  const skus = [...new Set(batches.map(b => {
    const p = products.find(x => x.id === b.product_id)
    return p?.sku
  }).filter(Boolean))]

  const { data: inserted } = await supabase
    .from('products')
    .select('id, sku')
    .in('sku', skus)

  const skuToId = {}
  ;(inserted || []).forEach(p => { skuToId[p.sku] = p.id })

  // Remap batch product_ids to actual DB ids
  const remappedBatches = batches.map(b => {
    const p   = products.find(x => x.id === b.product_id)
    const dbId = p ? skuToId[p.sku] : null
    return dbId ? { ...b, product_id: dbId } : null
  }).filter(Boolean)

  // Insert batches in chunks
  for (let i = 0; i < remappedBatches.length; i += CHUNK) {
    const chunk = remappedBatches.slice(i, i + CHUNK)
    onProgress(`上传库存批次 ${i+1}–${Math.min(i+CHUNK, remappedBatches.length)} / ${remappedBatches.length}…`)
    const { error } = await supabase.from('batches').insert(chunk)
    if (error) results.errors.push(`批次错误：${error.message}`)
    else results.batchOk += chunk.length
  }

  return results
}

// ════════════════════════════════════════════════════════════════
export default function ImportPage({ shout, refetch }) {
  const [platform,   setPlatform]   = useState('Shopee MY')
  const [salesFile,  setSalesFile]  = useState(null)
  const [mediaFile,  setMediaFile]  = useState(null)
  const [step,       setStep]       = useState('upload')  // upload|preview|uploading|done
  const [parsed,     setParsed]     = useState(null)
  const [validation, setValidation] = useState(null)
  const [progress,   setProgress]   = useState('')
  const [uploadResult, setUploadResult] = useState(null)
  const [logs,       setLogs]       = useState([])

  const isShopee  = platform.startsWith('Shopee')
  const headerIdx = isShopee ? 4 : 2

  const addLog = msg => setLogs(p => [...p, msg])
  const reset  = () => {
    setSalesFile(null); setMediaFile(null); setParsed(null)
    setValidation(null); setStep('upload'); setLogs([]); setUploadResult(null)
  }

  // ── Step 1: Parse & validate ───────────────────────────────
  const handleParse = async () => {
    if (!salesFile) { shout('请先上传主文件', true); return }
    setLogs([]); setStep('upload')
    try {
      addLog('读取 Excel 文件…')
      const salesRows = await readXlsx(salesFile)
      const mediaRows = mediaFile ? await readXlsx(mediaFile) : []
      addLog(`解析到 ${salesRows.length} 行产品，${mediaRows.length} 行图片`)

      if (salesRows.length === 0) {
        addLog('❌ 无法读取产品数据，请确认文件格式')
        shout('无法读取数据', true); return
      }
      addLog(`字段预览：${Object.keys(salesRows[0]).slice(0,5).join(' | ')}`)

      addLog('解析产品结构…')
      const result = parseProducts(salesRows, mediaRows, platform)
      addLog(`✅ 解析完成：${result.products.length} 个产品/变体，${result.batches.length} 笔库存`)

      addLog('执行验证检查…')
      const v = validate(result.products, result.batches)
      if (v.errors.length > 0) {
        v.errors.forEach(e => addLog(`❌ 错误：${e}`))
      }
      if (v.warnings.length > 0) {
        v.warnings.forEach(w => addLog(`⚠️ 警告：${w}`))
      }
      if (v.valid) addLog('✅ 验证通过，可以上传')

      setParsed(result); setValidation(v); setStep('preview')
    } catch(e) {
      addLog(`❌ ${e.message}`)
      shout('解析失败：' + e.message, true)
    }
  }

  // ── Step 2: Upload ─────────────────────────────────────────
  const handleUpload = async () => {
    if (!parsed || !validation?.valid) return
    setStep('uploading'); setProgress('准备上传…')
    try {
      const result = await uploadToSupabase(
        parsed.products, parsed.batches,
        msg => setProgress(msg)
      )
      setUploadResult(result)
      setStep('done')
      if (result.errors.length === 0) {
        shout(`✅ 上传成功！${result.inserted} 个产品，${result.batchOk} 笔库存`)
        refetch && refetch()
      } else {
        shout(`上传完成，但有 ${result.errors.length} 个错误`, true)
      }
    } catch(e) {
      shout('上传失败：' + e.message, true)
      setStep('preview')
    }
  }

  const totalStock = parsed?.batches.reduce((s,b)=>s+b.qty,0) || 0

  return (
    <div>
      {/* Header */}
      <div style={{...S.card, background:C.navy}}>
        <div style={{color:C.orange, fontWeight:700, fontSize:15, marginBottom:4}}>
          📥 Excel 导入工具
        </div>
        <div style={{color:C.slateLight, fontSize:11, lineHeight:1.7}}>
          上传 Excel → 自动解析 → 验证检查 → 直接写入数据库
        </div>
        {/* Step indicator */}
        <div style={{display:'flex', gap:6, marginTop:10}}>
          {[['1','上传'],['2','预览检查'],['3','写入数据库']].map(([n,l],i) => {
            const isActive = (step==='upload'&&i===0)||(step==='preview'&&i===1)||
                             ((step==='uploading'||step==='done')&&i===2)
            const isDone   = (i===0&&step!=='upload')||(i===1&&(step==='uploading'||step==='done'))
            return (
              <div key={n} style={{display:'flex', alignItems:'center', gap:4}}>
                <div style={{width:20,height:20,borderRadius:'50%',fontSize:10,fontWeight:700,
                             display:'flex',alignItems:'center',justifyContent:'center',
                             background:isDone?C.green:isActive?C.orange:C.navyMid,
                             color:'#fff'}}>
                  {isDone ? '✓' : n}
                </div>
                <span style={{fontSize:10,color:isActive?C.orange:isDone?C.green:C.slateLight}}>
                  {l}
                </span>
                {i<2&&<span style={{color:C.navyMid,fontSize:10}}>→</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── STEP 1: Upload ───────────────────────────────────── */}
      {(step==='upload'||step==='preview') && (
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

          {/* Main file */}
          {[
            {
              key:'sales', file:salesFile, set:setSalesFile,
              label: isShopee?'Sales Info / Inventory Info *':'Price & Stock Excel *',
              desc:  isShopee
                ?'Seller Centre → Batch Tools → Mass Update → Sales Info 或 Inventory Info'
                :'Seller Centre → Manage Products → Export → pricestock',
            },
            {
              key:'media', file:mediaFile, set:setMediaFile,
              label: isShopee?'Media Info（选填，含图片）':'Basic Info（选填，含图片）',
              desc:  isShopee?'Mass Update → Media Info':'Manage Products → Export → basic',
              optional: true,
            },
          ].map(({key,file,set,label,desc,optional})=>(
            <div key={key} style={{marginBottom:12}}>
              <label style={{...S.lbl,fontSize:12}}>
                {label}
                {optional&&<span style={{color:C.slateLight,fontWeight:400}}> (选填)</span>}
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
                  onChange={e=>{set(e.target.files[0]);setParsed(null);setValidation(null);setStep('upload');setLogs([])}}/>
              </label>
            </div>
          ))}

          <button onClick={handleParse} disabled={!salesFile}
            style={{...S.btn(salesFile?C.orange:C.slateLight),opacity:salesFile?1:0.5}}>
            🔍 解析并验证
          </button>

          {/* Parse logs */}
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

      {/* ── STEP 2: Preview & Validate ───────────────────────── */}
      {step==='preview' && parsed && validation && (
        <div>
          {/* Validation result */}
          <div style={{...S.card,
            border:`2px solid ${validation.valid?C.green:C.red}`,
            background:validation.valid?C.green+'06':C.red+'06'}}>
            <div style={{fontWeight:700,fontSize:14,
              color:validation.valid?C.green:C.red,marginBottom:8}}>
              {validation.valid?'✅ 验证通过，可以上传':'❌ 发现错误，请修正后重新上传'}
            </div>

            {/* Stats */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
              {[
                [parsed.products.length,'产品/变体',C.navy],
                [parsed.batches.length,'库存批次',C.navy],
                [totalStock,'总库存件数',C.navy],
                [parsed.products.filter(p=>p.photo_url).length,'有图片',C.blue],
              ].map(([v,l,col])=>(
                <div key={l} style={{background:C.cream,borderRadius:8,padding:'8px 10px'}}>
                  <div style={{fontSize:18,fontWeight:900,color:col}}>{v}</div>
                  <div style={{fontSize:10,color:C.slate}}>{l}</div>
                </div>
              ))}
            </div>

            {/* Errors */}
            {validation.errors.map((e,i)=>(
              <div key={i} style={{fontSize:12,color:C.red,marginBottom:4,
                padding:'6px 10px',background:C.red+'10',borderRadius:6}}>
                ❌ {e}
              </div>
            ))}

            {/* Warnings */}
            {validation.warnings.map((w,i)=>(
              <div key={i} style={{fontSize:12,color:C.yellow,marginBottom:4,
                padding:'6px 10px',background:C.yellow+'10',borderRadius:6}}>
                ⚠️ {w}
              </div>
            ))}

            {/* Extra notes */}
            <div style={{fontSize:11,color:C.slate,marginTop:8,lineHeight:1.7}}>
              • 成本暂用售价 50%，上传后请在产品页更新实际成本<br/>
              • 重复 SKU 会自动跳过（不覆盖已有产品）<br/>
              • 图片来自平台 CDN，产品下架后可能失效
            </div>
          </div>

          {/* Preview table — first 10 products */}
          <div style={S.card}>
            <div style={S.secTitle}>
              产品预览（前 {Math.min(10, parsed.preview.length)} 条，共 {parsed.preview.length} 条）
            </div>
            {parsed.preview.slice(0,10).map((p,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,
                paddingBottom:8,marginBottom:8,
                borderBottom:i<9?`1px solid ${C.cream}`:'none'}}>
                {p.img
                  ? <img src={p.img} onError={e=>e.target.style.display='none'}
                      style={{width:36,height:36,borderRadius:7,objectFit:'cover',flexShrink:0}}/>
                  : <div style={{width:36,height:36,borderRadius:7,background:C.cream,
                                 display:'flex',alignItems:'center',justifyContent:'center',
                                 fontSize:16,flexShrink:0}}>📦</div>
                }
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:p.isParent?700:500,
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                    color:p.isParent?C.orange:C.navy}}>
                    {p.isParent?'📁 ':''}{p.name}
                  </div>
                  <div style={{fontSize:10,color:C.slate,fontFamily:'monospace'}}>{p.sku}</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontSize:12,fontWeight:700}}>
                    {p.price>0?`${p.currency} ${p.price.toFixed(2)}`:'—'}
                  </div>
                  <div style={{fontSize:10,color:p.qty>0?C.green:C.slate}}>
                    {p.qty>0?`${p.qty}件`:'无库存'}
                  </div>
                </div>
              </div>
            ))}
            {parsed.preview.length>10&&(
              <div style={{textAlign:'center',fontSize:11,color:C.slate,padding:'6px'}}>
                还有 {parsed.preview.length-10} 条未显示
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{display:'flex',gap:8}}>
            <button onClick={reset} style={S.btn(C.slate,false)}>
              ← 重新上传
            </button>
            <button onClick={handleUpload} disabled={!validation.valid}
              style={{...S.btn(validation.valid?C.green:C.slateLight),
                      flex:1,opacity:validation.valid?1:0.5}}>
              ✅ 确认无误，写入数据库
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Uploading ─────────────────────────────────── */}
      {step==='uploading'&&(
        <div style={{...S.card,textAlign:'center',padding:'40px 20px'}}>
          <div style={{fontSize:36,marginBottom:12}}>⏳</div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>写入数据库中…</div>
          <div style={{fontSize:12,color:C.slate}}>{progress}</div>
          <div style={{marginTop:16,height:4,background:C.cream,borderRadius:2,overflow:'hidden'}}>
            <div style={{height:'100%',background:C.orange,
                         animation:'loading 1.5s ease-in-out infinite',width:'60%'}}/>
          </div>
          <style>{`@keyframes loading{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}`}</style>
        </div>
      )}

      {/* ── STEP 4: Done ──────────────────────────────────────── */}
      {step==='done'&&uploadResult&&(
        <div>
          <div style={{...S.card,
            background:uploadResult.errors.length===0?C.green+'12':C.yellow+'12',
            border:`2px solid ${uploadResult.errors.length===0?C.green:C.yellow}`}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:12,
              color:uploadResult.errors.length===0?C.green:C.yellow}}>
              {uploadResult.errors.length===0?'🎉 上传成功！':'⚠️ 上传完成（有部分错误）'}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
              {[
                [uploadResult.inserted,'已写入产品',C.green],
                [uploadResult.batchOk,'已写入库存批次',C.green],
                [uploadResult.errors.length,'错误数',uploadResult.errors.length>0?C.red:C.green],
                [totalStock,'总库存件数',C.navy],
              ].map(([v,l,col])=>(
                <div key={l} style={{background:'#fff',borderRadius:8,padding:'8px 10px'}}>
                  <div style={{fontSize:18,fontWeight:900,color:col}}>{v}</div>
                  <div style={{fontSize:10,color:C.slate}}>{l}</div>
                </div>
              ))}
            </div>
            {uploadResult.errors.map((e,i)=>(
              <div key={i} style={{fontSize:11,color:C.red,marginBottom:4,
                padding:'6px 10px',background:C.red+'10',borderRadius:6}}>❌ {e}</div>
            ))}
            <div style={{fontSize:11,color:C.slate,marginTop:8}}>
              ✅ 可以到「产品」页更新实际成本<br/>
              ✅ 如需再导入其他平台，点下方重新开始
            </div>
          </div>
          <button onClick={reset} style={S.btn()}>📥 导入其他平台</button>
        </div>
      )}
    </div>
  )
}
