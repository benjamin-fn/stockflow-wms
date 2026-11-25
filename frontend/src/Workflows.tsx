import {useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {ClipboardList,PackageCheck,Plus,Trash2} from 'lucide-react';
import {action,api,day,number} from './api';
import type {Count,Delivery,Order} from './types';
import {Badge,binOf,binOptions,Form,Input,int,Load,Modal,nameOf,Pages,pickOptions,Select,skuOf,str,Table,useData} from './ui';
import type {PageProps} from './ui';

function DocumentLines({lookups,receipt}:{lookups:PageProps['lookups'];receipt:boolean}){
  const [lines,setLines]=useState([0]);
  const [next,setNext]=useState(1);
  return <div className="document-lines"><h3>Artikelrader</h3>{lines.map(id=><div className="line" key={id}><Select label="Artikel" name={'product-'+id} options={pickOptions(lookups)}/>{receipt&&<Select label="Lagerplats" name={'location-'+id} options={binOptions(lookups)}/>}<Input label={receipt?'Förväntat antal':'Antal'} name={'qty-'+id} type="number" min={1} max={100000000}/>{lines.length>1&&<button className="icon" type="button" aria-label="Ta bort rad" onClick={()=>setLines(lines.filter(x=>x!==id))}><Trash2 size={17}/></button>}</div>)}{lines.length<100&&<button type="button" className="secondary" onClick={()=>{setLines([...lines,next]);setNext(next+1)}}><Plus size={16}/>Lägg till rad</button>}</div>;
}
function getLines(f:FormData){
  return [...f.keys()].filter(k=>k.startsWith('product-')).map(k=>{const id=k.slice(8);return {productId:int(f,k),locationId:int(f,'location-'+id),quantity:int(f,'qty-'+id)}});
}
function WorkflowList<T extends {id:number;status:string;created:string}>({items,headers,rows}:{items:T[];headers:string[];rows:(row:T)=>React.ReactNode[]}){
  const [filter,setFilter]=useState('');
  const [page,setPage]=useState(1);
  const unique=Array.from(new Set(items.map(i=>i.status)));
  const filtered=items.filter(i=>!filter||i.status===filter);
  const current=Math.min(page,Math.max(1,Math.ceil(filtered.length/12)));
  return <><div className="filters"><label>Status<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(1)}}><option value="">Alla statusar</option>{unique.map(s=><OptionStatus key={s} status={s}/>)}</select></label></div><Table headers={headers} rows={filtered.slice((current-1)*12,current*12).map(rows)}/><Pages page={current} total={filtered.length} setPage={setPage}/></>;
}
import {labels} from './api';
function OptionStatus({status}:{status:string}){return <option value={status}>{labels[status]}</option>}
export function Deliveries(props:PageProps){
  const {data,error}=useData<Delivery[]>('/deliveries',props.version);
  const [params,setParams]=useSearchParams();
  const [open,setOpen]=useState(0);
  const [mode,setMode]=useState('');
  const delivery=data?.find(d=>d.id===open);
  const create=params.has('new');
  const close=()=>{setOpen(0);setMode('');setParams({})};
  function saved(message:string){setMode('');props.changed(message)}
  return <><div className="heading"><div><h1>Inleveranser</h1><p>Planera, ta emot och följ upp leveranser från leverantörer.</p></div><button className="primary" onClick={()=>setParams({new:'1'})}><Plus size={18}/>Ny inleverans</button></div>
    <section className="card"><Load ready={data} error={error}>{data&&<WorkflowList items={data} headers={['Referens','Leverantör','Skapad','Mottaget','Status']} rows={d=>[<button className="row-link" onClick={()=>setOpen(d.id)}>{d.reference}</button>,props.lookups.suppliers.find(s=>s.id===d.supplierId)?.name,day(d.created),number(d.lines.reduce((s,l)=>s+l.received,0))+' / '+number(d.lines.reduce((s,l)=>s+l.expected,0)),<Badge status={d.status}/>]}/>}</Load></section>
    {create&&<Modal title="Ny inleverans" close={close}><Form label="Skapa inleverans" save={async f=>{const d=await api<Delivery>('/deliveries','POST',{reference:str(f,'reference'),supplierId:int(f,'supplier'),lines:getLines(f)});close();setOpen(d.id);saved('Inleveransen har skapats.')}}><div className="form-grid"><Input label="Leveransreferens" name="reference"/><Select label="Leverantör" name="supplier" options={props.lookups.suppliers.filter(s=>s.active)}/></div><DocumentLines lookups={props.lookups} receipt/></Form></Modal>}
    {delivery&&!create&&<Modal title={delivery.reference} close={close}><div className="modal-meta"><Badge status={delivery.status}/><span>{props.lookups.suppliers.find(s=>s.id===delivery.supplierId)?.name}</span><span>{day(delivery.created)}</span></div><Table headers={['Artikel','Lagerplats','Förväntat','Mottaget']} rows={delivery.lines.map(l=>[nameOf(props.lookups,l.productId),binOf(props.lookups,l.locationId),number(l.expected),number(l.received)])}/>
      {!['Completed','Cancelled'].includes(delivery.status)&&<><div className="actions after"><button className="primary" onClick={()=>setMode('receive')}><PackageCheck size={17}/>Registrera mottagning</button>{delivery.status==='Planned'&&<button className="secondary" onClick={()=>setMode('start')}>Påbörja</button>}{delivery.lines.every(l=>l.received===0)&&<button className="secondary" onClick={()=>setMode('cancel')}>Avbryt leverans</button>}</div>
      {mode==='receive'&&<Form label="Registrera antal" save={async f=>{await action('/deliveries/'+open+'/'+(f.has('complete')?'complete':'receive'),{lines:delivery.lines.map(l=>({lineId:l.id,quantity:int(f,'qty-'+l.id)}))});saved('Mottagningen har registrerats.')}}><div className="form-grid after">{delivery.lines.map(l=><Input key={l.id} label={nameOf(props.lookups,l.productId)+' · '+binOf(props.lookups,l.locationId)+' (kvar '+number(l.expected-l.received)+')'} name={'qty-'+l.id} value={0} type="number" min={0} max={l.expected-l.received}/>)}</div><label className="check"><input type="checkbox" name="complete"/>Slutför leveransen</label></Form>}
      {['start','cancel'].includes(mode)&&<Form label="Bekräfta" save={async()=>{await action('/deliveries/'+open+'/'+mode);saved(mode==='start'?'Inleveransen har påbörjats.':'Inleveransen har avbrutits.')}}><p>{mode==='start'?'Påbörja mottagningen?':'Avbryta inleveransen?'}</p></Form>}</>}
    </Modal>}</>;
}
export function Orders(props:PageProps & {picking?:boolean}){
  const picking=props.picking;
  const {data,error}=useData<Order[]>(picking?'/picking':'/orders',props.version);
  const [create,setCreate]=useState(false);
  const [id,setId]=useState(0);
  const [mode,setMode]=useState('');
  const order=data?.find(o=>o.id===id);
  const close=()=>{setId(0);setCreate(false);setMode('')};
  function saved(message:string){setMode('');props.changed(message)}
  return <><div className="heading"><div><h1>{picking?'Plocklistor':'Utleveranser'}</h1><p>{picking?'Följ plockordrar och registrera plockat antal per lagerplats.':'Skapa order, reservera saldo och registrera försändelser.'}</p></div>{!picking&&<button className="primary" onClick={()=>setCreate(true)}><Plus size={18}/>Ny utleverans</button>}</div>
    <section className="card"><Load ready={data} error={error}>{data&&<WorkflowList items={data} headers={['Orderreferens','Mottagare','Skapad','Rader','Status']} rows={o=>[<button className="row-link" onClick={()=>setId(o.id)}>{o.reference}</button>,o.customer,day(o.created),number(o.picking?.reservations.length??o.lines.length),<Badge status={o.status}/>]}/>}</Load></section>
    {create&&<Modal title="Ny utleverans" close={close}><Form label="Skapa utleverans" save={async f=>{const o=await api<Order>('/orders','POST',{reference:str(f,'reference'),customer:str(f,'customer'),lines:getLines(f)});close();setId(o.id);saved('Utleveransen har skapats.')}}><div className="form-grid"><Input label="Orderreferens" name="reference"/><Input label="Mottagare" name="customer"/></div><DocumentLines lookups={props.lookups} receipt={false}/></Form></Modal>}
    {order&&<Modal title={order.reference} close={close}><div className="modal-meta"><Badge status={order.status}/><span>{order.customer}</span><span>{day(order.created)}</span></div><OrderDetails {...props} order={order} mode={mode} setMode={setMode} saved={saved}/></Modal>}
  </>;
}
function OrderDetails({lookups,order,supervisor,userId,mode,setMode,saved}:PageProps & {order:Order;mode:string;setMode:(mode:string)=>void;saved:(s:string)=>void}){
  const rows=[...(order.picking?.reservations??[])].sort((a,b)=>binOf(lookups,a.locationId).localeCompare(binOf(lookups,b.locationId),'sv'));
  const canPick=['Reserved','Picking'].includes(order.status);
  const open=['Waiting','Reserved','Picking','Picked'].includes(order.status);
  return <>{order.picking?<Table headers={['Artikelnummer','Artikel','Lagerplats','Antal att plocka','Plockat','Status']} rows={rows.map(r=>[skuOf(lookups,r.productId),nameOf(lookups,r.productId),binOf(lookups,r.locationId),number(r.quantity),number(r.picked),<Badge status={r.picked===r.quantity?'Picked':r.picked>0?'Picking':'Waiting'}/>])}/>:<Table headers={['Artikelnummer','Artikel','Antal']} rows={order.lines.map(r=>[skuOf(lookups,r.productId),nameOf(lookups,r.productId),number(r.quantity)])}/>}
    {order.picking&&supervisor&&<AssigneeName id={order.picking.assigneeId}/>}
    <div className="actions after">{supervisor&&order.status==='Waiting'&&<button className="primary" onClick={()=>setMode('reserve')}>Reservera saldo</button>}{supervisor&&canPick&&<button className="secondary" onClick={()=>setMode('assign')}>Tilldela plock</button>}{canPick&&(supervisor||order.picking?.assigneeId===userId)&&<button className="primary" onClick={()=>setMode('pick')}><ClipboardList size={17}/>Registrera plock</button>}{supervisor&&order.status==='Picked'&&<button className="primary" onClick={()=>setMode('ship')}>Skicka order</button>}{supervisor&&open&&<button className="secondary" onClick={()=>setMode('cancel')}>Avbryt order</button>}</div>
    {mode==='assign'&&<AssigneeForm order={order} saved={saved}/>}
    {mode==='pick'&&<Form label="Spara plock" save={async f=>{await action('/orders/'+order.id+'/pick',{lines:rows.map(r=>({lineId:r.id,quantity:int(f,'qty-'+r.id)}))});saved('Plockningen har sparats.')}}><div className="form-grid after">{rows.map(r=><Input key={r.id} label={binOf(lookups,r.locationId)+' · '+nameOf(lookups,r.productId)+' (max '+number(r.quantity)+')'} name={'qty-'+r.id} type="number" min={0} max={r.quantity} value={r.picked}/>)}</div></Form>}
    {['reserve','ship','cancel'].includes(mode)&&<Form label="Bekräfta" save={async()=>{await action('/orders/'+order.id+'/'+mode);saved(mode==='reserve'?'Saldot har reserverats.':mode==='ship'?'Ordern har skickats.':'Ordern har avbrutits.')}}><p>{mode==='reserve'?'Reservera saldot och skapa en plocklista?':mode==='ship'?'Skicka ordern och dra av det plockade saldot?':'Avbryta ordern och frigöra reservationerna?'}</p></Form>}
  </>;
}
type Assignee={id:string;userName:string};
function AssigneeName({id}:{id?:string}){
  const {data}=useData<Assignee[]>('/assignees');
  return <p className="subtle">Tilldelad: {id?(data?.find(u=>u.id===id)?.userName??'Tidigare användare'):'Ingen'}</p>;
}
function AssigneeForm({order,saved}:{order:Order;saved:(s:string)=>void}){
  const {data,error}=useData<Assignee[]>('/assignees');
  return <Load ready={data} error={error}>{data&&<Form label="Tilldela" save={async f=>{await action('/orders/'+order.id+'/assign',{assigneeId:str(f,'assignee')});saved('Plocklistan har tilldelats.')}}><Select label="Användare" name="assignee" value={order.picking?.assigneeId} options={data.map(u=>({id:u.id,name:u.userName}))}/></Form>}</Load>;
}
export function Counts(props:PageProps){
  const {data,error}=useData<Count[]>('/counts',props.version);
  const [mode,setMode]=useState('');
  const [id,setId]=useState(0);
  const count=data?.find(c=>c.id===id);
  function saved(message:string){setMode('');props.changed(message)}
  return <><div className="heading"><div><h1>Inventering</h1><p>Räkna fysiskt saldo, granska avvikelser och godkänn korrigeringar.</p></div><button className="primary" onClick={()=>setMode('create')}><Plus size={17}/>Ny inventering</button></div><section className="card"><Load ready={data} error={error}>{data&&<WorkflowList items={data} headers={['Inventering','Skapad','Rader','Avvikelser','Status']} rows={c=>[<button className="row-link" onClick={()=>setId(c.id)}>INV-{c.id}</button>,day(c.created),number(c.lines.length),number(c.lines.filter(l=>l.counted!==null&&l.counted!==l.expected).length),<Badge status={c.status}/>]}/>}</Load></section>
    {mode==='create'&&<Modal title="Ny inventering" close={()=>setMode('')}><Form label="Skapa inventering" save={async f=>{const productId=int(f,'product')||null,locationId=int(f,'location')||null;if(!productId&&!locationId)throw new Error('Välj en artikel eller lagerplats.');const c=await api<Count>('/counts','POST',{productId,locationId});setId(c.id);saved('Inventeringen har skapats.')}}><Select label="Artikel" name="product" required={false} options={props.lookups.products}/><Select label="Lagerplats" name="location" required={false} options={binOptions(props.lookups)}/></Form></Modal>}
    {count&&mode!=='create'&&<Modal title={'Inventering INV-'+id} close={()=>{setId(0);setMode('')}}><div className="modal-meta"><Badge status={count.status}/><span>{day(count.created)}</span></div><Table headers={['Artikel','Plats','Förväntat','Räknat','Avvikelse']} rows={count.lines.map(l=>[nameOf(props.lookups,l.productId),binOf(props.lookups,l.locationId),number(l.expected),l.counted===null?'—':number(l.counted),l.counted===null?'—':number(l.counted-l.expected)])}/>{count.reason&&<p>Orsak: {count.reason}</p>}
    {count.status==='Draft'&&<><div className="actions after"><button className="secondary" onClick={()=>setMode('record')}>Registrera räkning</button>{count.lines.every(l=>l.counted!==null)&&<button className="primary" onClick={()=>setMode('approve')}>Godkänn korrigering</button>}</div>
    {mode==='record'&&<Form label="Spara räknat antal" save={async f=>{await action('/counts/'+id+'/record',{lines:count.lines.filter(l=>str(f,'qty-'+l.id)!=='').map(l=>({lineId:l.id,quantity:int(f,'qty-'+l.id)}))});saved('Räkningen har sparats.')}}><div className="form-grid after">{count.lines.map(l=><Input label={nameOf(props.lookups,l.productId)+' · '+binOf(props.lookups,l.locationId)} key={l.id} name={'qty-'+l.id} type="number" min={0} value={l.counted??''} required={false}/>)}</div></Form>}
    {mode==='approve'&&<Form label="Godkänn och uppdatera saldo" save={async f=>{await action('/counts/'+id+'/approve',{reason:str(f,'reason')});saved('Inventeringen har godkänts.')}}><label>Orsak till korrigering<textarea name="reason" maxLength={500} required/></label></Form>}</>}
    </Modal>}
  </>;
}
