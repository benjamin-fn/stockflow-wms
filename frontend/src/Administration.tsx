import {useState} from 'react';
import {Download,Plus} from 'lucide-react';
import {api,day,labels,number,query} from './api';
import type {Movement,Page,Role} from './types';
import {Badge,binOf,Form,Input,Load,Modal,nameOf,Pages,Select,str,Table,useData} from './ui';
import type {PageProps} from './ui';

const types=['Receipt','Shipment','TransferIn','TransferOut','Adjustment'];
export function Transactions({lookups,version}:PageProps){
  const [page,setPage]=useState(1);
  const [filters,setFilters]=useState({product:'',location:'',type:'',user:'',from:'',to:''});
  const {data,error}=useData<Page<Movement>>('/transactions'+query({...filters,page}),version);
  function change(key:keyof typeof filters,value:string){setFilters({...filters,[key]:value});setPage(1)}
  return <><div className="heading"><div><h1>Transaktionshistorik</h1><p>Spåra varje saldoförändring, referens och ansvarig användare.</p></div></div><section className="card"><div className="filters"><label>Artikel<select value={filters.product} onChange={e=>change('product',e.target.value)}><option value="">Alla artiklar</option>{lookups.products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>Lagerplats<select value={filters.location} onChange={e=>change('location',e.target.value)}><option value="">Alla platser</option>{lookups.locations.map(l=><option value={l.id} key={l.id}>{l.code}</option>)}</select></label><label>Typ<select value={filters.type} onChange={e=>change('type',e.target.value)}><option value="">Alla typer</option>{types.map(t=><option key={t} value={t}>{labels[t]}</option>)}</select></label><label>Användare<input value={filters.user} onChange={e=>change('user',e.target.value)} placeholder="Sök användare"/></label><label>Från<input type="date" value={filters.from} onChange={e=>change('from',e.target.value)}/></label><label>Till<input type="date" value={filters.to} onChange={e=>change('to',e.target.value)}/></label></div>
  <Load ready={data} error={error}>{data&&<><Table headers={['Datum','Artikel','Typ','Plats','Antal','Före','Efter','Referens','Användare','Orsak']} rows={data.items.map(m=>[day(m.timestamp),nameOf(lookups,m.productId),<Badge status={m.type}/>,binOf(lookups,m.locationId),number(m.quantity),number(m.before),number(m.after),m.reference,m.user,m.reason||'—'])}/><Pages page={page} total={data.total} setPage={setPage}/></>}</Load></section></>;
}
const reportTypes=[['value','Lagervärde'],['movements','Lagerrörelser'],['low','Artiklar med lågt saldo'],['deliveries','Leveransstatistik'],['picking','Plockstatistik'],['counts','Inventeringsavvikelser']];
function download(headers:string[],rows:string[][],name:string){
  const escape=(value:string)=>'"'+(/^[=+@\t\r\n]|^-(?!\d+(?:,\d+)?$)/.test(value)?"'"+value:value).replaceAll('"','""')+'"';
  const url=URL.createObjectURL(new Blob(['\uFEFF'+[headers,...rows].map(row=>row.map(escape).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='stockflow-'+name+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function Reports({version}:PageProps){
  const [type,setType]=useState('value');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [page,setPage]=useState(1);
  const snapshot=['value','low'].includes(type);
  const {data,error}=useData<{headers:string[];rows:string[][]}>('/reports/'+type+query({from:snapshot?'':from,to}),version);
  return <><div className="heading"><div><h1>Rapporter</h1><p>Analysera lagersaldo och verksamhetens flöden.</p></div><button className="primary" disabled={!data} onClick={()=>data&&download(data.headers,data.rows,type)}><Download size={17}/>Exportera CSV</button></div>
    <section className="card"><div className="filters"><label>Rapport<select value={type} onChange={e=>{setType(e.target.value);setPage(1)}}>{reportTypes.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>{!snapshot&&<label>Från<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}}/></label>}<label>{snapshot?'Saldo per datum':'Till'}<input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1)}}/></label>{snapshot&&<span className="subtle">Historiskt saldo värderas med aktuella inköpspriser.</span>}</div><Load ready={data} error={error}>{data&&<><Table headers={data.headers} rows={data.rows.slice((page-1)*12,page*12)}/><Pages page={page} total={data.rows.length} setPage={setPage}/></>}</Load></section></>;
}
type User={id:string;userName:string;role:Role;active:boolean};
const roles=['Administrator','Supervisor','Worker'].map(id=>({id,name:labels[id]}));
export function Users({version,changed,userId}:PageProps){
  const {data,error}=useData<User[]>('/users',version);
  const [mode,setMode]=useState('');
  const [user,setUser]=useState<User>();
  const close=()=>setMode('');
  return <><div className="heading"><div><h1>Användare</h1><p>Hantera konton, roller och behörigheter.</p></div><button className="primary" onClick={()=>{setUser(undefined);setMode('create')}}><Plus size={17}/>Ny användare</button></div><section className="card"><Load ready={data} error={error}>{data&&<Table headers={['Användarnamn','Roll','Status','']} rows={data.map(u=>[u.userName,labels[u.role],<Badge status={u.active?'Active':'Inactive'}/>,u.id!==userId?<button className="text-link" onClick={()=>{setUser(u);setMode('edit')}}>Redigera</button>:'Ditt konto'])}/>}</Load></section>
    {mode&&<Modal title={user?'Redigera '+user.userName:'Ny användare'} close={close}><Form save={async f=>{await api(user?'/users/'+user.id:'/users',user?'PUT':'POST',{username:str(f,'username'),password:str(f,'password'),role:str(f,'role'),active:f.has('active')});close();changed('Användaren har sparats.')}}>{!user&&<><Input label="Användarnamn" name="username"/><Input label="Lösenord" type="password" name="password"/><p className="subtle">Minst åtta tecken med stor och liten bokstav, siffra och specialtecken.</p></>}<Select label="Roll" name="role" options={roles} value={user?.role}/>{user&&<label className="check"><input type="checkbox" name="active" defaultChecked={user.active}/>Aktivt konto</label>}</Form></Modal>}</>;
}
export function Settings({changed,version}:PageProps){
  const {data,error}=useData<{name:string}>('/settings',version);
  return <><div className="heading"><div><h1>Inställningar</h1><p>Ställ in namnet som visas i arbetsytan.</p></div></div><section className="card panel settings"><header><h2>Arbetsyta</h2></header><Load ready={data} error={error}>{data&&<Form save={async f=>{await api('/settings','PUT',{name:str(f,'name')});changed('Inställningarna har sparats.')}}><Input label="Lagrets namn" name="name" value={data.name}/></Form>}</Load></section></>;
}
