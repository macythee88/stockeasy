// src/pages/ProductsPage.jsx — 条码栏加相机扫码
import { useState, useRef, useMemo } from 'react'
import { C, S, StatusBadge } from '../App'
import { uploadPhoto } from '../lib/supabase'
import BarcodeScanner from '../components/BarcodeScanner'

const CATEGORIES = ['全部','维他命/保健品','护肤/美容','个人护理','厨房/家居',
                    '母婴/儿童','健康/医疗','食品/饮料','文具/办公','运动/户外',
                    '电子/配件','服装/配件','日本进口','其他']
const PLATFORMS  = ['全部','Shopee SG','Shopee MY','Lazada MY','Lazada SG','多平台']
const STOCK_FILTERS  = [{id:'all',label:'全部'},{id:'ok',label:'充足'},{id:'low',label:'需补货'},{id:'out',label:'缺货'}]
const EXPIRY_FILTERS = [{id:'all',label:'全部'},{id:'ok',label:'正常'},{id:'warning',label:'快到期'},{id:'expired',label:'已过期'}]
const SORT_OPTIONS   = [{id:'name',label:'名称 A→Z'},{id:'price_h',label:'价格高→低'},{id:'price_l',label:'价格低→高'},{id:'stock_l',label:'库存少→多'},{id:'stock_h',label:'库存多→少'}]

const EMPTY = {
  name:'', variant_name:'', sku:'', barcode:'', cost:'', price:'',
  shopee_sku:'', lazada_sku:'', min_stock:'30', reorder_days:'30',
  has_expiry:false, platform:'Shopee SG', supplier_id:'',
  photo_url:'', parent_id:null, category:'其他'
}

const currency = p => (p||'').toLowerCase().includes('my')?'RM':'SGD'
const fmt = (amount,platform) => `${currency(platform)} ${Number(amount||0).toFixed(2)}`

function genBarcode(sku) {
  const d=sku.replace(/[^a-zA-Z0-9]/g,'').split('').map(c=>c.charCodeAt(0)%10).join('').slice(0,11).padEnd(11,'0')
  return '9'+d
}

function BarcodeDisplay({value}) {
  if (!value) return null
  const bars=[]; let x=8
  for(let i=0;i<value.length;i++){
    const n=parseInt(value[i])||0
    for(let b=0;b<4;b++){
      const f=(n>>b)&1
      bars.push(<rect key={`${i}-${b}`} x={x} y={0} width={2} height={f?50:36} fill={f?'#0F1B2D':'#ccc'} rx={1}/>)
      x+=3
    }
    x+=2
  }
  return (
    <div style={{textAlign:'center',padding:'10px',background:C.cream,borderRadius:10}}>
      <svg width="100%" viewBox={`0 0 ${x+8} 66`} style={{maxWidth:260}}>
        {bars}
        <text x={(x+8)/2} y={62} textAnchor="middle" fontSize={10} fill={C.slate} fontFamily="monospace">{value}</text>
      </svg>
      <div style={{fontSize:10,color:C.slateLight}}>可截图打印贴在产品上</div>
    </div>
  )
}

function ProductPhoto({url,size=44,radius=8}) {
  const [broken,setBroken]=useState(false)
  if (!url||broken) return (
    <div style={{width:size,height:size,borderRadius:radius,background:C.cream,flexShrink:0,
                 display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                 border:`1px dashed ${broken?C.yellow:C.slateLight}50`}}>
      {broken?<><span style={{fontSize:size>36?14:10}}>⚠️</span>
               <span style={{fontSize:8,color:C.yellow}}>图片失效</span></>
             :<span style={{fontSize:size>36?20:14}}>📦</span>}
    </div>
  )
  return <img src={url} onError={()=>setBroken(true)}
    style={{width:size,height:size,borderRadius:radius,objectFit:'cover',flexShrink:0}} alt=""/>
}

function Pill({active,onClick,children,color=C.orange}){
  return <button onClick={onClick} style={{padding:'5px 12px',borderRadius:20,
    border:`1.5px solid ${active?color:C.slateLight+'50'}`,
    background:active?color:'#fff',color:active?'#fff':C.slate,
    fontSize:11,fontWeight:active?700:400,cursor:'pointer',whiteSpace:'nowrap'}}>
    {children}
  </button>
}

export default function ProductsPage({products,batches,suppliers,totalStock,upsertProduct,shout}) {
  const [showForm,  setShowForm]  = useState(false)
  const [form,      setForm]      = useState(EMPTY)
  const [editId,    setEditId]    = useState(null)
  const [uploading, setUploading] = useState(false)
  const [searchQ,   setSearchQ]   = useState('')
  const [catFilter,    setCatFilter]    = useState('全部')
  const [platFilter,   setPlatFilter]   = useState('全部')
  const [stockFilter,  setStockFilter]  = useState('all')
  const [expiryFilter, setExpiryFilter] = useState('all')
  const [sortBy,       setSortBy]       = useState('name')
  const [showFilters,  setShowFilters]  = useState(false)
  const photoRef = useRef()

  const parentProducts = products.filter(p=>!p.parent_id)
  const variantMap = {}
  products.filter(p=>p.parent_id).forEach(p=>{
    if(!variantMap[p.parent_id]) variantMap[p.parent_id]=[]
    variantMap[p.parent_id].push(p)
  })

  const today = new Date()
  const nearestExpiry = pid => {
    const exp = batches.filter(b=>b.product_id===pid&&b.expiry_date&&b.qty>0)
      .sort((a,b)=>a.expiry_date.localeCompare(b.expiry_date))
    return exp[0]?.expiry_date||null
  }
  const expiryDays = d => d?Math.ceil((new Date(d)-today)/864e5):null
  const expStatus = days => days===null?'none':days<=0?'expired':days<=30?'warning':'ok'

  const filtered = useMemo(()=>{
    let list = parentProducts
    if(searchQ){
      const q=searchQ.toLowerCase()
      list=list.filter(p=>p.name?.toLowerCase().includes(q)||p.sku?.toLowerCase().includes(q)||
        p.shopee_sku?.toLowerCase().includes(q)||(variantMap[p.id]||[]).some(v=>v.sku?.toLowerCase().includes(q)))
    }
    if(catFilter!=='全部')   list=list.filter(p=>p.category===catFilter)
    if(platFilter!=='全部')  list=list.filter(p=>(p.platform||'').includes(platFilter))
    if(stockFilter!=='all'){
      list=list.filter(p=>{const s=totalStock(p.id);const st=s<=0?'out':s<p.min_stock?'low':'ok';return st===stockFilter})
    }
    if(expiryFilter!=='all'){
      list=list.filter(p=>{
        const d=nearestExpiry(p.id);const days=expiryDays(d);const st=expStatus(days)
        if(expiryFilter==='ok')      return st==='ok'||st==='none'
        if(expiryFilter==='warning') return st==='warning'
        if(expiryFilter==='expired') return st==='expired'
        return true
      })
    }
    return [...list].sort((a,b)=>{
      if(sortBy==='name')    return (a.name||'').localeCompare(b.name||'')
      if(sortBy==='price_h') return (b.price||0)-(a.price||0)
      if(sortBy==='price_l') return (a.price||0)-(b.price||0)
      if(sortBy==='stock_l') return totalStock(a.id)-totalStock(b.id)
      if(sortBy==='stock_h') return totalStock(b.id)-totalStock(a.id)
      return 0
    })
  },[products,batches,searchQ,catFilter,platFilter,stockFilter,expiryFilter,sortBy])

  const activeFilters=[catFilter!=='全部',platFilter!=='全部',stockFilter!=='all',expiryFilter!=='all'].filter(Boolean).length

  const handlePhoto=async(e)=>{
    const file=e.target.files[0]; if(!file)return
    if(!form.sku){shout('请先填写 SKU，再上传照片',true);return}
    setUploading(true)
    try{
      const {uploadPhoto:up}=await import('../lib/supabase')
      const url=await up(file,form.sku)
      setForm(f=>({...f,photo_url:url})); shout('照片上传成功 ✓')
    }catch{
      const r=new FileReader()
      r.onload=ev=>setForm(f=>({...f,photo_url:ev.target.result}))
      r.readAsDataURL(file)
      shout('离线：照片暂存本地')
    }
    setUploading(false)
  }

  const handleSave=async()=>{
    if(!form.name||!form.sku){shout('请填写产品名称和 SKU',true);return}
    const data={...form,id:editId||crypto.randomUUID(),cost:parseFloat(form.cost)||0,
      price:parseFloat(form.price)||0,min_stock:parseInt(form.min_stock)||30,
      reorder_days:parseInt(form.reorder_days)||30,supplier_id:form.supplier_id||null,parent_id:form.parent_id||null}
    try{await upsertProduct(data);shout(editId?'产品已更新 ✓':'产品已新增 ✓');setForm(EMPTY);setEditId(null);setShowForm(false)}
    catch(e){shout('保存失败：'+(e.message||''),true)}
  }

  const openEdit=p=>{
    setForm({...EMPTY,...p,cost:String(p.cost||''),price:String(p.price||''),
      min_stock:String(p.min_stock||30),reorder_days:String(p.reorder_days||30),supplier_id:p.supplier_id||''})
    setEditId(p.id);setShowForm(true)
  }

  // ── FORM ───────────────────────────────────────────────────
  if(showForm) return (
    <div>
      <button onClick={()=>{setShowForm(false);setEditId(null);setForm(EMPTY)}}
        style={{background:'none',border:'none',color:C.orange,fontWeight:700,fontSize:14,cursor:'pointer',paddingBottom:12}}>
        ← 返回
      </button>
      <div style={S.card}>
        <div style={S.secTitle}>{editId?'编辑产品':'新增产品'}{form.parent_id?' (变体)':''}</div>

        {/* Photo */}
        <div style={{textAlign:'center',marginBottom:16}}>
          <div onClick={()=>photoRef.current?.click()} style={{width:88,height:88,borderRadius:14,
            background:C.cream,border:`2px dashed ${C.slateLight}60`,margin:'0 auto 8px',
            cursor:'pointer',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {form.photo_url?<ProductPhoto url={form.photo_url} size={88} radius={12}/>
              :<div style={{textAlign:'center',color:C.slate}}>
                <div style={{fontSize:26}}>{uploading?'⏳':'📷'}</div>
                <div style={{fontSize:10}}>{uploading?'上传中…':'上传照片'}</div>
              </div>}
          </div>
          <input ref={photoRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePhoto}/>
          <button onClick={()=>photoRef.current?.click()}
            style={{background:'none',border:`1px solid ${C.orange}`,color:C.orange,
                   borderRadius:6,padding:'4px 12px',fontSize:12,cursor:'pointer'}}>
            {form.photo_url?'更换照片':'选择照片'}
          </button>
          <div style={{marginTop:8}}>
            <label style={S.lbl}>或直接贴图片网址</label>
            <input style={{...S.inp,fontSize:11}} placeholder="https://..."
              value={form.photo_url||''} onChange={e=>setForm(f=>({...f,photo_url:e.target.value}))}/>
          </div>
        </div>

        {/* Platform */}
        <div style={{marginBottom:12}}>
          <label style={S.lbl}>主要平台（影响货币显示）</label>
          <select style={S.inp} value={form.platform} onChange={e=>setForm(f=>({...f,platform:e.target.value}))}>
            {PLATFORMS.filter(p=>p!=='全部').map(p=><option key={p}>{p}</option>)}
          </select>
          <div style={{fontSize:11,color:C.orange,marginTop:4,fontWeight:600}}>货币：{currency(form.platform)}</div>
        </div>

        {/* Basic fields */}
        {[['产品名称 *','name','text'],['变体名称（颜色/尺寸）','variant_name','text'],
          ['内部 SKU *','sku','text'],
          [`售价 (${currency(form.platform)})`,'price','number'],
          [`进货成本 (${currency(form.platform)})`,'cost','number'],
          ['Shopee SKU','shopee_sku','text'],['Lazada SKU','lazada_sku','text']].map(([l,k,t])=>(
          <div key={k} style={{marginBottom:10}}>
            <label style={S.lbl}>{l}</label>
            <input type={t} style={S.inp} value={form[k]||''}
              onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}/>
          </div>
        ))}

        {/* Barcode — with camera scanner */}
        <div style={{marginBottom:12}}>
          <label style={S.lbl}>条形码</label>
          <BarcodeScanner
            value={form.barcode||''}
            onChange={v=>setForm(f=>({...f,barcode:v}))}
            onScan={code=>{setForm(f=>({...f,barcode:code}));shout(`条码已扫入：${code}`)}}
            placeholder="扫描或手动输入条码…"
          />
          <button type="button" onClick={()=>{
            if(!form.sku){shout('先填SKU',true);return}
            setForm(f=>({...f,barcode:genBarcode(f.sku)}))
          }} style={{...S.btn('#3498DB',true,true),marginTop:8}}>
            🔢 自动生成条码
          </button>
          {form.barcode&&<div style={{marginTop:8}}><BarcodeDisplay value={form.barcode}/></div>}
        </div>

        {/* Category */}
        <div style={{marginBottom:12}}>
          <label style={S.lbl}>产品分类</label>
          <select style={S.inp} value={form.category||'其他'}
            onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
            {CATEGORIES.filter(c=>c!=='全部').map(c=><option key={c}>{c}</option>)}
          </select>
        </div>

        {/* Reorder */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          <div><label style={S.lbl}>🔒 安全库存</label>
               <input type="number" style={S.inp} value={form.min_stock}
                 onChange={e=>setForm(f=>({...f,min_stock:e.target.value}))}/></div>
          <div><label style={S.lbl}>📈 补货天数</label>
               <input type="number" style={S.inp} value={form.reorder_days}
                 onChange={e=>setForm(f=>({...f,reorder_days:e.target.value}))}/></div>
        </div>

        {/* Supplier */}
        <div style={{marginBottom:12}}>
          <label style={S.lbl}>供应商</label>
          <select style={S.inp} value={form.supplier_id||''}
            onChange={e=>setForm(f=>({...f,supplier_id:e.target.value}))}>
            <option value="">— 选择供应商 —</option>
            {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Expiry toggle */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                     background:C.purple+'10',borderRadius:8,padding:'10px 12px',marginBottom:16}}>
          <div><div style={{fontSize:13,fontWeight:700}}>⏰ 效期管理</div>
               <div style={{fontSize:11,color:C.slate}}>食品、保养品、药品</div></div>
          <div onClick={()=>setForm(f=>({...f,has_expiry:!f.has_expiry}))}
            style={{width:44,height:24,borderRadius:12,background:form.has_expiry?C.purple:C.slateLight,
                   cursor:'pointer',position:'relative',transition:'all .2s'}}>
            <div style={{position:'absolute',top:2,left:form.has_expiry?22:2,
                         width:20,height:20,borderRadius:10,background:'#fff',transition:'all .2s'}}/>
          </div>
        </div>

        <button onClick={handleSave} style={S.btn()}>💾 {editId?'保存更改':'新增产品'}</button>
      </div>
    </div>
  )

  // ── LIST ────────────────────────────────────────────────────
  return (
    <div>
      <div style={{display:'flex',gap:8,marginBottom:10}}>
        <input style={{...S.inp,flex:1}} placeholder="搜索产品名 / SKU…"
          value={searchQ} onChange={e=>setSearchQ(e.target.value)}/>
        <button onClick={()=>setShowFilters(f=>!f)}
          style={{...S.btn(showFilters?C.orange:C.navyMid,false,true),flexShrink:0}}>
          🔽{activeFilters>0?` (${activeFilters})`:''}
        </button>
        <button onClick={()=>{setForm(EMPTY);setEditId(null);setShowForm(true)}}
          style={{...S.btn(C.green,false,true),flexShrink:0}}>+ 新增</button>
      </div>

      {showFilters&&(
        <div style={{...S.card,padding:'12px 14px',marginBottom:10}}>
          {[['分类',CATEGORIES,catFilter,setCatFilter,C.orange],
            ['平台',PLATFORMS, platFilter,setPlatFilter,C.blue]].map(([title,opts,val,setVal,col])=>(
            <div key={title} style={{marginBottom:10}}>
              <div style={S.secTitle}>{title}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {opts.map(o=><Pill key={o} active={val===o} onClick={()=>setVal(o)} color={col}>{o}</Pill>)}
              </div>
            </div>
          ))}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div>
              <div style={S.secTitle}>库存状态</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {STOCK_FILTERS.map(f=><Pill key={f.id} active={stockFilter===f.id} onClick={()=>setStockFilter(f.id)} color={C.red}>{f.label}</Pill>)}
              </div>
            </div>
            <div>
              <div style={S.secTitle}>效期状态</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {EXPIRY_FILTERS.map(f=><Pill key={f.id} active={expiryFilter===f.id} onClick={()=>setExpiryFilter(f.id)} color={C.purple}>{f.label}</Pill>)}
              </div>
            </div>
          </div>
          <div>
            <div style={S.secTitle}>排序</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {SORT_OPTIONS.map(o=><Pill key={o.id} active={sortBy===o.id} onClick={()=>setSortBy(o.id)} color={C.slate}>{o.label}</Pill>)}
            </div>
          </div>
          {activeFilters>0&&(
            <button onClick={()=>{setCatFilter('全部');setPlatFilter('全部');setStockFilter('all');setExpiryFilter('all')}}
              style={{...S.btn(C.slate,true,true),marginTop:10}}>✕ 清除筛选</button>
          )}
        </div>
      )}

      <div style={{fontSize:11,color:C.slate,marginBottom:8}}>
        显示 {filtered.length} / {parentProducts.length} 个产品
      </div>

      {filtered.length===0&&(
        <div style={{...S.card,textAlign:'center',padding:'32px',color:C.slate}}>
          <div style={{fontSize:32,marginBottom:8}}>🔍</div>
          <div>{searchQ?'找不到相关产品':'暂无产品'}</div>
        </div>
      )}

      {filtered.map(p=>{
        const variants=variantMap[p.id]||[]
        const stock=totalStock(p.id)
        const cur=currency(p.platform)
        const nearExp=nearestExpiry(p.id)
        const expDays=expiryDays(nearExp)
        const expSt=expStatus(expDays)
        const stockSt=stock<=0?'out':stock<p.min_stock?'low':'ok'
        return (
          <div key={p.id} style={{...S.card,
            borderLeft:`3px solid ${stockSt==='ok'?C.green:stockSt==='low'?C.yellow:C.red}`}}>
            <div style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:10}}>
              <ProductPhoto url={p.photo_url} size={52} radius={10}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,lineHeight:1.3,marginBottom:3,
                             overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                  {p.category&&p.category!=='其他'&&<span style={{...S.tag(C.blue),fontSize:9}}>{p.category}</span>}
                  {p.platform&&<span style={{...S.tag(C.slate),fontSize:9}}>{p.platform}</span>}
                  {p.has_expiry&&<span style={{...S.tag(C.purple),fontSize:9}}>⏰效期</span>}
                </div>
                {nearExp&&expSt!=='ok'&&expSt!=='none'&&(
                  <div style={{fontSize:10,color:expSt==='expired'?C.red:C.yellow,marginTop:3,fontWeight:600}}>
                    {expSt==='expired'?'⛔ 有批次已过期':`⏰ 最近批次 ${expDays} 天到期`}
                  </div>
                )}
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:20,fontWeight:900,
                             color:stockSt==='ok'?C.navy:stockSt==='low'?C.yellow:C.red}}>{stock}</div>
                <StatusBadge stock={stock} min={p.min_stock}/>
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:10}}>
              {[['售价',fmt(p.price,p.platform),C.navy],
                ['成本',fmt(p.cost,p.platform),C.slate],
                ['毛利',fmt((p.price||0)-(p.cost||0),p.platform),(p.price||0)>(p.cost||0)?C.green:C.red]].map(([l,v,col])=>(
                <div key={l} style={{textAlign:'center',background:C.cream,borderRadius:7,padding:'6px 4px'}}>
                  <div style={{fontSize:11,fontWeight:800,color:col}}>{v}</div>
                  <div style={{fontSize:9,color:C.slate}}>{l}</div>
                </div>
              ))}
            </div>

            {variants.length>0&&(
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,color:C.slate,marginBottom:4}}>{variants.length+1} 个变体：</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                  {[p,...variants].map(v=>{
                    const vs=totalStock(v.id)
                    const vst=vs<=0?'out':vs<v.min_stock?'low':'ok'
                    return(
                      <div key={v.id} onClick={()=>openEdit(v)}
                        style={{display:'flex',alignItems:'center',gap:4,padding:'4px 8px',
                                background:C.cream,borderRadius:8,cursor:'pointer',
                                border:`1px solid ${vst==='ok'?C.cream:vst==='low'?C.yellow:C.red}`}}>
                        <ProductPhoto url={v.photo_url} size={20} radius={4}/>
                        <span style={{fontSize:11}}>{v.variant_name||'默认'}</span>
                        <span style={{fontSize:11,fontWeight:700,
                                      color:vst==='ok'?C.navy:C.red}}>{vs}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div style={{display:'flex',gap:6}}>
              <button onClick={()=>openEdit(p)} style={S.btn(C.navyMid,true,true)}>✏ 编辑</button>
              <button onClick={()=>{setForm({...EMPTY,name:p.name,parent_id:p.id,
                photo_url:p.photo_url,supplier_id:p.supplier_id||'',
                platform:p.platform,category:p.category||'其他'})
                setEditId(null);setShowForm(true)
              }} style={S.btn(C.blue,true,true)}>+ 变体</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
