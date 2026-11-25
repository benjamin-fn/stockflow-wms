import {useState} from 'react';
import {Link,useParams,useSearchParams} from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import {Archive,ArrowLeft,ArrowRightLeft,Barcode,Plus,Printer,Search} from 'lucide-react';
import {action,api,day,money,number,query} from './api';
import type {Balance,Delivery,Location,Page,Product,ProductStock,Supplier} from './types';
import {Badge,binOf,binOptions,Form,Input,int,Load,Modal,nameOf,Pages,pickOptions,Select,str,Table,useData} from './ui';
import type {PageProps} from './ui';

export function Products(props:PageProps){
  const [params,setParams]=useSearchParams();
  const [category,setCategory]=useState('');
  const [sort,setSort]=useState('name');
  const [page,setPage]=useState(1);
  const [create,setCreate]=useState(false);
  const search=params.get('search')??'';
  const {data,error}=useData<Page<ProductStock>>('/products'+query({search,category,sort:sort.split(':')[0],descending:sort.includes(':' )?'true':'',page}),props.version);
  return <><div className="heading"><div><h1>Artikelregister</h1><p>Sök artiklar och följ saldo, reservationer och lagerplatser.</p></div>{props.supervisor&&<button className="primary" onClick={()=>setCreate(true)}><Plus size={18}/>Ny artikel</button>}</div>
    <section className="card"><div className="filters"><label className="search"><Search size={17}/><input aria-label="Sök i artikelregistret" placeholder="Sök namn, artikelnummer eller streckkod" value={search} onChange={e=>{setPage(1);setParams(e.target.value?{search:e.target.value}:{},{replace:true})}}/></label><select aria-label="Kategori" value={category} onChange={e=>{setPage(1);setCategory(e.target.value)}}><option value="">Alla kategorier</option>{props.lookups.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="Sortering" value={sort} onChange={e=>{setPage(1);setSort(e.target.value)}}><option value="name">Namn A–Ö</option><option value="name:desc">Namn Ö–A</option><option value="sku">Artikelnummer</option><option value="cost:desc">Högsta inköpspris</option></select></div>
    <Load error={error} ready={data}>{data&&<><Table headers={['Artikel','Kategori','Saldo','Reserverat','Tillgängligt','Status']} rows={data.items.map(({product:p,quantity,reserved,available})=>[<Link className="row-link" to={'/products/'+p.id}>{p.name}<small>{p.sku}</small></Link>,props.lookups.categories.find(c=>c.id===p.categoryId)?.name,number(quantity),number(reserved),number(available),<Badge status={!p.active?'Inactive':quantity<p.minimum?'Low':'Active'}/>])}/><Pages page={page} total={data.total} setPage={setPage}/></>}</Load></section>
    {create&&<Modal title="Ny artikel" close={()=>setCreate(false)}><ProductForm {...props} done={()=>setCreate(false)}/></Modal>}</>;
}
function ProductForm({lookups,changed,done,product:p}:{lookups:PageProps['lookups'];changed:PageProps['changed'];done:()=>void;product?:Product}){
  return <Form save={async f=>{await api('/products'+(p?'/'+p.id:''),p?'PUT':'POST',{sku:str(f,'sku'),name:str(f,'name'),description:str(f,'description'),categoryId:int(f,'category'),supplierId:int(f,'supplier'),barcode:str(f,'barcode'),cost:int(f,'cost'),minimum:int(f,'minimum'),unit:str(f,'unit'),active:f.has('active')});done();changed('Artikeln har sparats.')}}>
    <div className="form-grid"><Input label="Artikelnummer" name="sku" value={p?.sku}/><Input label="Artikelnamn" name="name" value={p?.name}/><Select name="category" label="Kategori" options={lookups.categories} value={p?.categoryId}/><Select name="supplier" label="Leverantör" options={lookups.suppliers} value={p?.supplierId}/><Input label="Inköpspris (SEK)" name="cost" value={p?.cost??0} type="number" min={0} step="0.01"/><Input label="Minsta lagersaldo" name="minimum" value={p?.minimum??0} type="number" min={0}/><Input label="Enhet" name="unit" value={p?.unit??'st'}/><Input label="Streckkod (genereras om fältet är tomt)" name="barcode" value={p?.barcode} required={false}/></div><label>Beskrivning<textarea name="description" defaultValue={p?.description} maxLength={500}/></label><label className="check"><input name="active" type="checkbox" defaultChecked={p?.active??true}/>Aktiv artikel</label>
  </Form>;
}
export function ProductDetail(props:PageProps){
  const {id}=useParams();
  const {data,error}=useData<ProductStock>('/products/'+id,props.version);
  const [mode,setMode]=useState('');
  const p=data?.product;
  return <Load ready={data} error={error}>{p&&data&&<><Link to="/products" className="text-link"><ArrowLeft size={16}/>Artikelregister</Link><div className="heading"><div><h1>{p.name}</h1><p>{p.sku} · {p.description}</p></div><div className="actions"><button className="secondary" onClick={()=>setMode('barcode')}><Barcode size={17}/>Streckkod</button>{props.supervisor&&<><button className="secondary" onClick={()=>setMode('edit')}>Redigera</button>{p.active&&<button className="secondary" onClick={()=>setMode('archive')}><Archive size={17}/>Arkivera</button>}</>}</div></div>
    <div className="card panel"><header><h2>Artikeluppgifter</h2><Badge status={p.active?'Active':'Inactive'}/></header><dl className="details"><div><dt>Kategori</dt><dd>{props.lookups.categories.find(c=>c.id===p.categoryId)?.name}</dd></div><div><dt>Leverantör</dt><dd>{props.lookups.suppliers.find(s=>s.id===p.supplierId)?.name}</dd></div><div><dt>Inköpspris</dt><dd>{money(p.cost,2)}</dd></div><div><dt>Minsta saldo</dt><dd>{number(p.minimum)} {p.unit}</dd></div><div><dt>Fysiskt saldo</dt><dd>{number(data.quantity)} {p.unit}</dd></div><div><dt>Reserverat</dt><dd>{number(data.reserved)} {p.unit}</dd></div><div><dt>Tillgängligt</dt><dd>{number(data.available)} {p.unit}</dd></div><div><dt>Streckkod</dt><dd>{p.barcode}</dd></div></dl></div>
    <div className="card panel after"><header><h2>Saldo per lagerplats</h2>{data.quantity<p.minimum&&<span className="badge status-Partial">Under minsta saldo</span>}</header><Table headers={['Lagerplats','Fysiskt','Reserverat','Tillgängligt']} rows={data.balances.map(b=>[binOf(props.lookups,b.locationId),number(b.quantity),number(b.reserved),number(b.quantity-b.reserved)])}/></div>
    {mode==='edit'&&<Modal title="Redigera artikel" close={()=>setMode('')}><ProductForm {...props} product={p} done={()=>setMode('')}/></Modal>}
    {mode==='archive'&&<Modal title="Arkivera artikel" close={()=>setMode('')}><Form label="Arkivera" save={async()=>{await api('/products/'+p.id,'DELETE');setMode('');props.changed('Artikeln har arkiverats.')}}><p>Arkivera {p.name}? Artikelns historik finns kvar.</p></Form></Modal>}
    {mode==='barcode'&&<Modal title="Streckkodsetikett" close={()=>setMode('')}><div className="barcode-label"><strong>{p.name} · {p.sku}</strong><svg role="img" aria-label={'Streckkod '+p.barcode} ref={node=>{if(node)JsBarcode(node,p.barcode,{format:'CODE128',height:60,width:1.5})}}/></div><button className="primary no-print" onClick={()=>window.print()}><Printer size={17}/>Skriv ut</button></Modal>}
  </>}</Load>;
}
export function Locations(props:PageProps){
  const {data,error}=useData<{locations:Location[];balances:Balance[]}>('/locations',props.version);
  const [mode,setMode]=useState('');
  const [bin,setBin]=useState<Location>();
  const close=()=>setMode('');
  function saved(message:string){close();props.changed(message)}
  return <><div className="heading"><div><h1>Lagerplatser</h1><p>Hantera zoner, platser och interna lagerflyttar.</p></div><div className="actions">{props.supervisor&&<><button className="secondary" onClick={()=>setMode('zone')}>Ny zon</button><button className="secondary" onClick={()=>{setBin(undefined);setMode('edit')}}><Plus size={17}/>Ny lagerplats</button></>}<button className="primary" onClick={()=>setMode('transfer')}><ArrowRightLeft size={17}/>Flytta saldo</button></div></div>
    <section className="card"><Load ready={data} error={error}>{data&&<Table headers={['Lagerplats','Zon','Gång','Hylla','Beläggning','Status']} rows={data.locations.map(l=>[<button className="row-link" onClick={()=>{setBin(l);setMode('details')}}>{l.code}</button>,props.lookups.zones.find(z=>z.id===l.zoneId)?.name,l.aisle,l.shelf,number(data.balances.filter(b=>b.locationId===l.id).reduce((s,b)=>s+b.quantity,0))+' / '+number(l.capacity),<Badge status={l.active?'Active':'Inactive'}/>])}/>}</Load></section>
    {mode==='details'&&bin&&<Modal title={bin.code} close={close}><Table headers={['Artikel','Saldo','Reserverat']} rows={(data?.balances??[]).filter(b=>b.locationId===bin.id).map(b=>[nameOf(props.lookups,b.productId),number(b.quantity),number(b.reserved)])}/>{props.supervisor&&<button className="secondary after" onClick={()=>setMode('edit')}>Redigera lagerplats</button>}</Modal>}
    {mode==='edit'&&<Modal title={bin?'Redigera lagerplats':'Ny lagerplats'} close={close}><Form save={async f=>{await api('/locations'+(bin?'/'+bin.id:''),bin?'PUT':'POST',{code:str(f,'code'),aisle:str(f,'aisle'),shelf:str(f,'shelf'),capacity:int(f,'capacity'),zoneId:int(f,'zone'),active:f.has('active')});saved('Lagerplatsen har sparats.')}}><div className="form-grid"><Input label="Platskod" name="code" value={bin?.code}/><Select label="Zon" name="zone" options={props.lookups.zones} value={bin?.zoneId}/><Input label="Gång" name="aisle" value={bin?.aisle}/><Input label="Hylla" name="shelf" value={bin?.shelf}/><Input label="Maxkapacitet i enheter" name="capacity" value={bin?.capacity} type="number" min={1}/></div><label className="check"><input type="checkbox" name="active" defaultChecked={bin?.active??true}/>Aktiv lagerplats</label></Form></Modal>}
    {mode==='zone'&&<Modal title="Ny zon" close={close}><Form save={async f=>{await api('/zones','POST',{name:str(f,'name')});saved('Zonen har skapats.')}}><Input label="Zonnamn" name="name"/></Form></Modal>}
    {mode==='transfer'&&<Modal title="Flytta saldo" close={close}><Form label="Registrera flytt" save={async f=>{await action('/transfers',{productId:int(f,'product'),from:int(f,'from'),to:int(f,'to'),quantity:int(f,'quantity')});saved('Lagret har flyttats.')}}><Select label="Artikel" name="product" options={props.lookups.products.map(p=>({id:p.id,name:p.sku+' · '+p.name}))}/><div className="form-grid"><Select label="Från lagerplats" name="from" options={binOptions(props.lookups)}/><Select label="Till lagerplats" name="to" options={binOptions(props.lookups)}/><Input label="Antal" name="quantity" type="number" min={1}/></div></Form></Modal>}
  </>;
}
const supplierFields=[['name','Företagsnamn'],['contact','Kontaktperson'],['email','E-post'],['phone','Telefonnummer'],['address','Adress'],['organizationNumber','Organisationsnummer']] as const;
export function Suppliers(props:PageProps){
  const {data,error}=useData<{items:Supplier[];deliveries:Delivery[]}>('/suppliers',props.version);
  const [selected,setSelected]=useState<Supplier>();
  const [mode,setMode]=useState('');
  const done=()=>setMode('');
  return <><div className="heading"><div><h1>Leverantörer</h1><p>Kontaktuppgifter och leveranshistorik.</p></div>{props.supervisor&&<button className="primary" onClick={()=>{setSelected(undefined);setMode('edit')}}><Plus size={17}/>Ny leverantör</button>}</div><section className="card"><Load ready={data} error={error}>{data&&<Table headers={['Företagsnamn','Kontaktperson','E-post','Telefonnummer','Status']} rows={data.items.map(s=>[<button className="row-link" onClick={()=>{setSelected(s);setMode('details')}}>{s.name}</button>,s.contact,s.email,s.phone,<Badge status={s.active?'Active':'Inactive'}/>])}/>}</Load></section>
    {mode==='details'&&selected&&<Modal title={selected.name} close={done}><dl className="details">{supplierFields.slice(1).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{selected[key]||'—'}</dd></div>)}</dl><h3>Leveranshistorik</h3><Table headers={['Referens','Datum','Status']} rows={(data?.deliveries??[]).filter(d=>d.supplierId===selected.id).map(d=>[d.reference,day(d.created),<Badge status={d.status}/>])}/>{props.supervisor&&<div className="actions after"><button className="secondary" onClick={()=>setMode('edit')}>Redigera</button>{selected.active&&<button className="secondary" onClick={()=>setMode('archive')}>Arkivera</button>}</div>}</Modal>}
    {mode==='archive'&&selected&&<Modal title="Arkivera leverantör" close={done}><Form label="Arkivera" save={async()=>{await api('/suppliers/'+selected.id,'DELETE');done();props.changed('Leverantören har arkiverats.')}}><p>Arkivera {selected.name}?</p></Form></Modal>}
    {mode==='edit'&&<Modal title={selected?'Redigera leverantör':'Ny leverantör'} close={done}><Form save={async f=>{await api('/suppliers'+(selected?'/'+selected.id:''),selected?'PUT':'POST',{...Object.fromEntries(supplierFields.map(([key])=>[key,str(f,key)])),active:f.has('active')});done();props.changed('Leverantören har sparats.')}}><div className="form-grid">{supplierFields.map(([key,label])=><Input key={key} label={label} name={key} value={selected?.[key]} required={key==='name'} type={key==='email'?'email':'text'}/>)}</div><label className="check"><input type="checkbox" name="active" defaultChecked={selected?.active??true}/>Aktiv leverantör</label></Form></Modal>}
  </>;
}
export {pickOptions};
