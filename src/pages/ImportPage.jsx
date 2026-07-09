// src/pages/ImportPage.jsx
// Fixed version - no external xlsx library, uses built-in FileReader + manual TSV parsing
// Shopee exports are TSV-based Excel files that can be read as text

import { useState } from 'react'
import { C, S } from '../App'

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

function getCategory(name) {
  const t = (name || '').toLowerCase()
  for (const [cat, kws] of Object.entries(CATEGORIES)) {
    if (kws.some(k => t.includes(k))) return cat
  }
  return '其他'
}

function cleanName(name) {
  return (name || '').replace(/【.*?】/g, '').trim().slice(0, 120).replace(/'/g, "''")
}

function safeSku(s) {
  return (s || '').replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 50)
}

// ── Read file as text (handles both xlsx-as-text and csv) ──────
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    // Try reading as text first - Shopee xlsx files are often readable as text/TSV
    reader.readAsText(file, 'UTF-8')
  })
}

// ── Parse Shopee-style TSV/Excel text ─────────────────────────
function parseShopeeText(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))
  
  // Find header row (line 4, index 4 - contains "Product ID")
  let headerIdx = -1
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    if (lines[i].includes('Product ID') && lines[i].includes('Product Name')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return { headers: [], rows: [] }

  const headers = lines[headerIdx].split('\t').map(h => h.trim())
  const rows = []
  
  // Data starts 3 lines after header (skip mandatory/description rows)
  for (let i = headerIdx + 3; i < lines.length; i++) {
    const parts = lines[i].split('\t')
    if (!parts[0].trim() || !/^\d+$/.test(parts[0].trim())) continue
    const row = {}
    headers.forEach((h, j) => { row[h] = (parts[j] || '').trim() })
    rows.push(row)
  }
  return { headers, rows }
}

// ── Parse Lazada-style text ────────────────────────────────────
function parseLazadaText(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))
  
  // Lazada header is at line 2 (index 2)
  let headerIdx = -1
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].includes('Product ID') || lines[i].includes('SellerSKU')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return { headers: [], rows: [] }

  const headers = lines[headerIdx].split('\t').map(h => h.trim())
  const rows = []
  
  for (let i = headerIdx + 3; i < lines.length; i++) {
    const parts = lines[i].split('\t')
    if (!parts[0].trim()) continue
    const row = {}
    headers.forEach((h, j) => { row[h] = (parts[j] || '').trim() })
    rows.push(row)
  }
  return { headers, rows }
}

// ── Generate SQL (same logic as manual imports) ───────────────
function generateSQL(salesRows, mediaRows, platform, fileType) {
  const isShopee  = platform.startsWith('Shopee')
  const isMY      = platform.includes('MY')
  const currency  = isMY ? 'RM' : 'SGD'
  const prefix    = isShopee ? (isMY ? 'SHPMY' : 'SHPSG') : (isMY ? 'LZMY' : 'LZSG')
  const batchTag  = `LOT-${prefix}-IMPORT`

  // Media/image map
  const mediaMap = {}
  mediaRows.forEach(r => {
    const pid = r['Product ID']
    if (pid) mediaMap[pid] = r['Cover image'] || r['Product Images1'] || ''
  })

  // Group by Product ID
  const groups = {}
  salesRows.forEach(r => {
    const pid = r['Product ID']
    if (!pid) return
    if (!groups[pid]) groups[pid] = []
    groups[pid].push(r)
  })

  const seenSkus = {}
  const dedupSku = sku => {
    if (!seenSkus[sku]) { seenSkus[sku] = 0; return sku }
    return `${sku}-${++seenSkus[sku]}`
  }

  const pRows = [], bRows = []

  Object.entries(groups).forEach(([pid, variants]) => {
    const first   = variants[0]
    const rawName = first['Product Name'] || ''
    const cname   = cleanName(rawName)
    const cat     = getCategory(rawName)
    const cover   = mediaMap[pid] || ''
    const imgSql  = cover ? `'${cover.replace(/'/g, "''")}'` : 'NULL'

    if (variants.length === 1 && !first['Variation Name']) {
      const v      = variants[0]
      const rawSku = v['SKU'] || v['SellerSKU'] || `${prefix}-${pid.slice(-10)}`
      const sku    = dedupSku(safeSku(rawSku) || `${prefix}-${pid.slice(-10)}`)
      const qty    = parseInt(v['Stock'] || v['Quantity'] || '0') || 0
      const price  = parseFloat(v['Price'] || '0') || 0
      const vid    = crypto.randomUUID()
      const pSku   = isShopee
        ? (v['SKU'] || '').replace(/'/g, "''")
        : ''
      const lSku   = !isShopee
        ? (v['SellerSKU'] || '').replace(/'/g, "''")
        : ''

      pRows.push(
        `('${vid}'::uuid, NULL::uuid, '${cname}', NULL, '${sku}', ` +
        `${price.toFixed(2)}, ${price.toFixed(2)}, '${pSku}', '${lSku}', ` +
        `30, 30, false, '${platform}', '${cat}', ${imgSql})`
      )
      if (qty > 0) bRows.push({ vid, sku, qty, price, tag: batchTag })

    } else {
      const parentId = crypto.randomUUID()
      const psku     = dedupSku(`${prefix}-${pid.slice(-10)}-P`)
      pRows.push(
        `('${parentId}'::uuid, NULL::uuid, '${cname}', NULL, '${psku}', ` +
        `0, 0, '${pid}', '', 30, 30, false, '${platform}', '${cat}', ${imgSql})`
      )

      variants.forEach((v, i) => {
        const vid    = crypto.randomUUID()
        const vname  = (v['Variation Name'] || v['Variations Combo'] || `Variant ${i+1}`)
          .replace(/'/g, "''").slice(0, 80)
        const rawSku = v['SKU'] || v['SellerSKU'] || `${prefix}-${pid.slice(-10)}-V${i}`
        const vsku   = dedupSku(safeSku(rawSku) || `${prefix}-${pid.slice(-10)}-V${i}`)
        const qty    = parseInt(v['Stock'] || v['Quantity'] || '0') || 0
        const price  = parseFloat(v['Price'] || '0') || 0
        const pSku   = isShopee ? (v['SKU'] || '').replace(/'/g, "''") : ''
        const lSku   = !isShopee ? (v['SellerSKU'] || '').replace(/'/g, "''") : ''
        const vImg   = cover
        const vImgSql = vImg ? `'${vImg.replace(/'/g, "''")}'` : 'NULL'

        pRows.push(
          `('${vid}'::uuid, '${parentId}'::uuid, '${cname}', '${vname}', '${vsku}', ` +
          `${price.toFixed(2)}, ${price.toFixed(2)}, '${pSku}', '${lSku}', ` +
          `30, 30, false, '${platform}', '${cat}', ${vImgSql})`
        )
        if (qty > 0) bRows.push({ vid, sku: vsku, qty, price, tag: batchTag })
      })
    }
  })

  const totalStock = bRows.reduce((s, r) => s + r.qty, 0)

  const batchLines = bRows.map(({ vid, sku, qty, price, tag }) => {
    const bid    = crypto.randomUUID()
    const cost   = (price * 0.5).toFixed(2)
    const skuEsc = sku.replace(/'/g, "''")
    return (
      `INSERT INTO batches (id,product_id,batch_no,qty,received_date,expiry_date,cost)\n` +
      `SELECT '${bid}'::uuid, id, '${tag}', ${qty}, CURRENT_DATE, NULL, ${cost}\n` +
      `FROM products WHERE sku='${skuEsc}' LIMIT 1;`
    )
  })

  const step1 =
    `-- StockEasy: ${platform} 导入 | ${pRows.length} 产品 | ${currency}\n` +
    `-- 生成时间: ${new Date().toLocaleString()}\n\n` +
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS category  TEXT DEFAULT '其他';\n` +
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_url TEXT;\n\n` +
    `INSERT INTO products\n` +
    `  (id, parent_id, name, variant_name, sku, cost, price,\n` +
    `   shopee_sku, lazada_sku, min_stock, reorder_days, has_expiry,\n` +
    `   platform, category, photo_url)\nVALUES\n` +
    pRows.join(',\n') +
    `\nON CONFLICT (sku) DO NOTHING;\n\n` +
    `SELECT COUNT(*) as "导入产品数" FROM products WHERE platform = '${platform}';`

  const step2 =
    `-- StockEasy: ${platform} 库存批次 | ${batchLines.length} 批 | ${totalStock} 件\n` +
    `-- 成本暂用售价50%，请在产品页更新\n\n` +
    batchLines.join('\n\n')

  return { step1, step2, pCount: pRows.length, bCount: batchLines.length, totalStock, currency }
}

function downloadSQL(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ════════════════════════════════════════════════════════════════
export default function ImportPage({ shout }) {
  const [platform,   setPlatform]   = useState('Shopee MY')
  const [salesFile,  setSalesFile]  = useState(null)
  const [mediaFile,  setMediaFile]  = useState(null)
  const [processing, setProcessing] = useState(false)
  const [result,     setResult]     = useState(null)
  const [logs,       setLogs]       = useState([])

  const isShopee = platform.startsWith('Shopee')

  const addLog = msg => setLogs(prev => [...prev, msg])

  const processFiles = async () => {
    if (!salesFile) { shout('请先上传主文件', true); return }
    setProcessing(true)
    setResult(null)
    setLogs([])

    try {
      addLog('读取文件中…')
      const salesText = await readFileAsText(salesFile)
      const mediaText = mediaFile ? await readFileAsText(mediaFile) : ''

      addLog('解析数据结构…')
      const { rows: salesRows } = isShopee
        ? parseShopeeText(salesText)
        : parseLazadaText(salesText)

      const { rows: mediaRows } = mediaText
        ? (isShopee ? parseShopeeText(mediaText) : parseLazadaText(mediaText))
        : { rows: [] }

      addLog(`找到 ${salesRows.length} 行产品数据，${mediaRows.length} 行图片数据`)

      if (salesRows.length === 0) {
        shout('无法读取产品数据，请确认文件格式正确', true)
        setProcessing(false)
        return
      }

      addLog('生成 SQL…')
      const sql = generateSQL(salesRows, mediaRows, platform)
      setResult(sql)
      addLog(`✅ 完成！${sql.pCount} 个产品，${sql.bCount} 笔库存`)
      shout(`✓ 生成成功：${sql.pCount} 个产品，${sql.totalStock} 件库存`)

    } catch (e) {
      addLog(`❌ 错误：${e.message}`)
      shout('处理失败：' + (e.message || '请检查文件格式'), true)
      console.error(e)
    }
    setProcessing(false)
  }

  return (
    <div>
      {/* Header */}
      <div style={{ ...S.card, background:C.navy }}>
        <div style={{ color:C.orange, fontWeight:700, fontSize:15, marginBottom:4 }}>
          📥 Excel 导入工具
        </div>
        <div style={{ color:C.slateLight, fontSize:11, lineHeight:1.6 }}>
          上传平台 Excel → 生成 SQL → 在 Supabase 运行导入
        </div>
      </div>

      {/* Platform selector */}
      <div style={S.card}>
        <div style={S.secTitle}>选择平台</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:10 }}>
          {['Shopee MY','Shopee SG','Lazada MY','Lazada SG'].map(p => (
            <button key={p} onClick={() => { setPlatform(p); setSalesFile(null); setMediaFile(null); setResult(null); setLogs([]) }}
              style={{ padding:'8px 16px', borderRadius:20, border:'none', cursor:'pointer',
                background:platform===p?C.orange:C.cream,
                color:platform===p?'#fff':C.slate,
                fontWeight:platform===p?700:400, fontSize:12 }}>
              {p}
            </button>
          ))}
        </div>
        <div style={{ fontSize:11, color:C.slate }}>
          货币：<strong style={{ color:C.orange }}>
            {platform.includes('MY') ? 'RM' : 'SGD'}
          </strong>
        </div>
      </div>

      {/* File upload */}
      <div style={S.card}>
        <div style={S.secTitle}>上传文件</div>

        {/* Main file */}
        <div style={{ marginBottom:14 }}>
          <label style={{ ...S.lbl, fontSize:12 }}>
            {isShopee ? 'Sales Info / Inventory Info Excel *' : 'Price & Stock Excel *'}
          </label>
          <div style={{ fontSize:10, color:C.slateLight, marginBottom:6 }}>
            {isShopee
              ? 'Seller Centre → Batch Tools → Mass Update → Sales Info 或 Inventory Info'
              : 'Seller Centre → Manage Products → Export → pricestock'}
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:10, padding:'12px',
                          borderRadius:8, border:`1.5px dashed ${salesFile?C.green:C.slateLight}60`,
                          background:salesFile?C.green+'08':C.cream, cursor:'pointer' }}>
            <span style={{ fontSize:22 }}>{salesFile ? '✅' : '📄'}</span>
            <div>
              <div style={{ fontSize:12, fontWeight:600, color:salesFile?C.green:C.slate }}>
                {salesFile ? salesFile.name : '点击选择文件 (.xlsx)'}
              </div>
              {salesFile && <div style={{ fontSize:10, color:C.slate }}>{(salesFile.size/1024).toFixed(0)} KB</div>}
            </div>
            <input type="file" accept=".xlsx,.xls,.csv,.txt" style={{ display:'none' }}
              onChange={e => { setSalesFile(e.target.files[0]); setResult(null); setLogs([]) }} />
          </label>
        </div>

        {/* Media file */}
        <div style={{ marginBottom:14 }}>
          <label style={{ ...S.lbl, fontSize:12 }}>
            {isShopee ? 'Media Info Excel（选填，用于图片）' : 'Basic Info Excel（选填，用于图片）'}
          </label>
          <div style={{ fontSize:10, color:C.slateLight, marginBottom:6 }}>
            {isShopee
              ? 'Mass Update → Media Info'
              : 'Manage Products → Export → basic'}
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:10, padding:'12px',
                          borderRadius:8, border:`1.5px dashed ${mediaFile?C.blue:C.slateLight}40`,
                          background:mediaFile?C.blue+'08':C.cream, cursor:'pointer' }}>
            <span style={{ fontSize:22 }}>{mediaFile ? '🖼️' : '📷'}</span>
            <div>
              <div style={{ fontSize:12, color:mediaFile?C.blue:C.slate }}>
                {mediaFile ? mediaFile.name : '点击选择（可跳过）'}
              </div>
            </div>
            <input type="file" accept=".xlsx,.xls,.csv,.txt" style={{ display:'none' }}
              onChange={e => { setMediaFile(e.target.files[0]); setResult(null) }} />
          </label>
        </div>

        <button onClick={processFiles} disabled={!salesFile || processing}
          style={{ ...S.btn(!salesFile||processing ? C.slateLight : C.green),
                   opacity: salesFile&&!processing ? 1 : 0.5 }}>
          {processing ? '⏳ 处理中…' : '⚙️ 生成导入 SQL'}
        </button>

        {/* Log */}
        {logs.length > 0 && (
          <div style={{ marginTop:10, background:C.navyLight, borderRadius:8, padding:'10px 12px' }}>
            {logs.map((l,i) => (
              <div key={i} style={{ fontSize:11, color:C.cream, marginBottom:2 }}>
                {l.startsWith('✅') ? <span style={{ color:C.green }}>{l}</span>
                : l.startsWith('❌') ? <span style={{ color:C.red }}>{l}</span>
                : <span style={{ color:C.slateLight }}>{l}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div>
          {/* Stats */}
          <div style={{ ...S.card, background:C.navy }}>
            <div style={{ color:C.green, fontWeight:700, fontSize:14, marginBottom:8 }}>✅ SQL 生成成功</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {[
                [result.pCount,     '产品/变体'],
                [result.bCount,     '库存批次'],
                [result.totalStock, '总库存件数'],
                [result.currency,   '货币'],
              ].map(([v,l]) => (
                <div key={l} style={{ background:C.navyMid, borderRadius:8, padding:'8px 10px' }}>
                  <div style={{ fontSize:20, fontWeight:900, color:C.orange }}>{v}</div>
                  <div style={{ fontSize:10, color:C.slateLight }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Warning */}
          <div style={{ ...S.card, border:`1px solid ${C.yellow}40`, background:C.yellow+'08' }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.yellow, marginBottom:6 }}>⚠️ 重要</div>
            <div style={{ fontSize:11, color:C.navy, lineHeight:1.8 }}>
              1. 先运行 Step 1，看到 Success 后才运行 Step 2<br/>
              2. 成本暂用售价 50% 估算，导入后请更新实际成本<br/>
              3. 重复 SKU 自动跳过（ON CONFLICT DO NOTHING）<br/>
              4. 图片来自平台CDN，产品下架后会失效
            </div>
          </div>

          {/* Download buttons */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
            <button onClick={() => downloadSQL(result.step1,
              `${platform.replace(' ','-')}-step1-products.sql`)}
              style={S.btn(C.green)}>
              ⬇ Step 1<br/>
              <span style={{ fontSize:10, fontWeight:400 }}>产品 ({result.pCount}条)</span>
            </button>
            <button onClick={() => downloadSQL(result.step2,
              `${platform.replace(' ','-')}-step2-batches.sql`)}
              style={S.btn(C.blue)}>
              ⬇ Step 2<br/>
              <span style={{ fontSize:10, fontWeight:400 }}>库存 ({result.bCount}条)</span>
            </button>
          </div>

          {/* Supabase steps */}
          <div style={{ ...S.card, background:C.navyLight }}>
            <div style={{ color:C.orange, fontWeight:700, fontSize:12, marginBottom:8 }}>
              📋 Supabase 操作步骤
            </div>
            {[
              'SQL Editor → New query → 贴上 Step 1 → Run',
              '看到 Success → New query → 贴上 Step 2 → Run',
              '查看验证结果，确认产品数量正确',
            ].map((t, i) => (
              <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:6 }}>
                <div style={{ background:C.orange, color:'#fff', borderRadius:'50%', width:18, height:18,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                <div style={{ fontSize:11, color:C.cream }}>{t}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
