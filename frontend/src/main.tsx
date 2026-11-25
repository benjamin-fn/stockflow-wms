import {lazy,Suspense,useEffect,useState} from 'react';
import type {FormEvent, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Link,NavLink,Route,Routes,useLocation,useNavigate} from 'react-router-dom';
import {ArrowDownToLine,ArrowUpFromLine,Barcode,Bell,Boxes,Check,ChevronDown,ChevronRight,ClipboardCheck,ClipboardList,FileBarChart,History,LayoutDashboard,LogOut,Menu,Package,PanelLeftClose,Search,Settings as SettingsIcon,Truck,Users as UsersIcon,Warehouse,X} from 'lucide-react';
import {api,ApiError,labels,query} from './api';
import type {Dashboard as DashboardData,Lookups,Session} from './types';
const Dashboard=lazy(()=>import('./Dashboard'));
import {Locations,ProductDetail,Products,Suppliers} from './Catalog';
import {Counts,Deliveries,Orders} from './Workflows';
import {Reports,Settings,Transactions,Users} from './Administration';
import {Load,Modal,useData} from './ui';
import './style.css';

const sections=[
  {label:'Arbetsyta',links:[{path:'/',label:'Översikt',icon:LayoutDashboard},{path:'/products',label:'Artikelregister',icon:Package},{path:'/locations',label:'Lagerplatser',icon:Warehouse}]},
  {label:'Lagerflöden',links:[{path:'/deliveries',label:'Inleveranser',icon:ArrowDownToLine},{path:'/orders',label:'Utleveranser',icon:ArrowUpFromLine,role:'Supervisor'},{path:'/picking',label:'Plocklistor',icon:ClipboardList},{path:'/counts',label:'Inventering',icon:ClipboardCheck,role:'Supervisor'},{path:'/suppliers',label:'Leverantörer',icon:Truck}]},
  {label:'Uppföljning',links:[{path:'/transactions',label:'Transaktionshistorik',icon:History},{path:'/reports',label:'Rapporter',icon:FileBarChart,role:'Supervisor'}]},
  {label:'Administration',links:[{path:'/users',label:'Användare',icon:UsersIcon,role:'Administrator'},{path:'/settings',label:'Inställningar',icon:SettingsIcon,role:'Administrator'}]}
];
const allowed=(role:string,required?:string)=>!required||role==='Administrator'||role===required;
const Brand=()=> <div className="brand"><span><Boxes size={23}/></span><div>StockFlow<small>LAGERHANTERING</small></div></div>;

function Login({onLogin}:{onLogin:(s:Session)=>void}){
  const [error,setError]=useState('');
  const [pending,setPending]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(pending)return;
    const f=new FormData(e.currentTarget);setPending(true);setError('');
    try{await api('/auth/login','POST',{username:f.get('username'),password:f.get('password')});onLogin(await api<Session>('/auth/me'))}
    catch(e){setError(e instanceof Error?e.message:'Kunde inte logga in.')}
    finally{setPending(false)}
  }
  return <main className="login"><div className="login-side"><Brand/><div className="login-copy"><div className="login-icon"><Warehouse size={42}/></div><h1>Daglig lagerdrift</h1><p>Hantera artiklar, leveranser och plock i StockFlow WMS.</p></div></div><div className="login-body"><form onSubmit={submit} className="card login-form"><h2>Logga in</h2><p>Använd ditt lagerkonto för att öppna arbetsytan.</p><label>Användarnamn<input name="username" autoComplete="username" required autoFocus/></label><label>Lösenord<input name="password" type="password" autoComplete="current-password" required/></label>{error&&<p role="alert" className="notice error">{error}</p>}<button className="primary" disabled={pending}>{pending?'Loggar in…':'Logga in'}</button></form></div></main>;
}
function App(){
  const [session,setSession]=useState<Session|null>();
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    api<Session>('/auth/me').then(s=>{if(active)setSession(s)}).catch(e=>{if(active){setSession(null);if(!(e instanceof ApiError)||e.status!==401)setError('Kunde inte kontrollera sessionen.')}});
    const expired=()=>setSession(null);
    window.addEventListener('stockflow-session',expired);
    return()=>{active=false;window.removeEventListener('stockflow-session',expired)};
  },[]);
  if(session===undefined)return <main className="boot"><Load ready={false}>{null}</Load></main>;
  if(!session)return <>{error&&<div className="startup-error notice error" role="alert">{error}</div>}<Login onLogin={s=>{setError('');setSession(s)}}/></>;
  return <Workspace session={session} logout={()=>setSession(null)}/>;
}
function Workspace({session,logout}:{session:Session;logout:()=>void}){
  const [collapsed,setCollapsed]=useState(false);
  const [mobile,setMobile]=useState(false);
  const [panel,setPanel]=useState('');
  const [search,setSearch]=useState('');
  const [barcode,setBarcode]=useState(false);
  const [version,setVersion]=useState(0);
  const [toast,setToast]=useState('');
  const lookup=useData<Lookups>('/lookups',version);
  const settings=useData<{name:string}>('/settings',version);
  const notices=useData<DashboardData>('/dashboard',version);
  const nav=useNavigate(); const location=useLocation();
  const current=sections.flatMap(s=>s.links).find(n=>n.path==='/'+location.pathname.split('/')[1]);
  useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),4200);return()=>clearTimeout(id)},[toast,version]);
  function changed(message:string){setVersion(v=>v+1);setToast(message)}
  function globalSearch(e:FormEvent<HTMLFormElement>){e.preventDefault();nav('/products'+query({search:search.trim()}));setSearch('');setPanel('')}
  async function signOut(){try{await api('/auth/logout','POST');logout()}catch(e){if(e instanceof ApiError&&e.status===401)logout();else setToast(e instanceof Error?e.message:'Kunde inte logga ut.')}}
  const props=lookup.data?{lookups:lookup.data,version,changed,supervisor:session.role!=='Worker',userId:session.id}:null;
  const guard=(role:string,element:ReactNode)=>allowed(session.role,role)?element:<div className="notice error" role="alert">Du har inte behörighet att visa den här sidan.</div>;
  return <div className={'shell'+(collapsed?' collapsed':'')+(mobile?' mobile-open':'')}><a className="skip" href="#workspace">Gå till innehåll</a>
    {mobile&&<button className="sidebar-shade" aria-label="Stäng navigering" onClick={()=>setMobile(false)}/>}
    <aside className="sidebar"><div className="sidebar-brand"><Link to="/" aria-label="StockFlow startsida" onClick={()=>setMobile(false)}><Brand/></Link></div><nav aria-label="Huvudnavigation">{sections.map(s=>{const links=s.links.filter(n=>allowed(session.role,n.role));return links.length>0&&<div className="nav-section" key={s.label}><div>{s.label}</div>{links.map(n=><NavLink key={n.path} to={n.path} end={n.path==='/'} title={n.label} onClick={()=>{setMobile(false);setPanel('')}}><n.icon size={18}/><span>{n.label}</span></NavLink>)}</div>})}</nav>
    <div className="sidebar-bottom"><span className="tile"><Warehouse size={17}/></span><div><strong>{settings.data?.name??'StockFlow WMS'}</strong><small>Lagerarbetsyta</small></div></div></aside>
    <div className="workspace"><header className="topbar"><div className="top-left"><button className="icon desktop-toggle" aria-label={collapsed?'Fäll ut navigering':'Fäll ihop navigering'} onClick={()=>setCollapsed(!collapsed)}><PanelLeftClose size={19}/></button><button className="icon mobile-toggle" aria-label="Öppna navigering" onClick={()=>setMobile(true)}><Menu size={21}/></button><div className="crumb"><span>Lager</span><ChevronRight size={13}/><strong>{current?.label??'Arbetsyta'}</strong></div></div>
      <div className="top-right"><form className="global search" onSubmit={globalSearch}><Search size={17}/><input aria-label="Sök artiklar" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Sök artiklar…"/><button type="button" className="icon" aria-label="Sök med streckkod" onClick={()=>setBarcode(true)}><Barcode size={17}/></button></form><button type="button" className="icon mobile-search" aria-label="Sök med streckkod" onClick={()=>setBarcode(true)}><Barcode size={18}/></button>
      <div className="popover-anchor"><button className="icon notification-button" aria-label="Aviseringar" aria-expanded={panel==='notices'} onClick={()=>setPanel(panel==='notices'?'':'notices')}><Bell size={20}/>{!!notices.data?.low&&<i/>}</button>{panel==='notices'&&<section className="popover card"><header><h2>Aviseringar</h2><button className="icon" aria-label="Stäng aviseringar" onClick={()=>setPanel('')}><X size={17}/></button></header><Load ready={notices.data} error={notices.error}>{notices.data?.alerts.length?<div className="alerts">{notices.data.alerts.map(a=><Link key={a.product.id} to={'/products/'+a.product.id} onClick={()=>setPanel('')}><span><strong>{a.product.name}</strong><small>Under minsta saldo</small></span><span>{a.quantity} {a.product.unit}</span></Link>)}</div>:<p>Inga lageraviseringar.</p>}</Load></section>}</div>
      <div className="popover-anchor"><button className="profile" aria-label="Användarmeny" aria-expanded={panel==='profile'} onClick={()=>setPanel(panel==='profile'?'':'profile')}><span className="avatar">{session.username.slice(0,2).toUpperCase()}</span><span className="profile-text"><strong>{session.username}</strong><small>{labels[session.role]}</small></span><ChevronDown size={14}/></button>{panel==='profile'&&<section className="popover card profile-pop"><p><strong>{session.username}</strong><br/>{labels[session.role]}</p>{session.role==='Administrator'&&<Link to="/settings" className="button secondary" onClick={()=>setPanel('')}><SettingsIcon size={16}/>Inställningar</Link>}<button className="secondary" onClick={signOut}><LogOut size={16}/>Logga ut</button></section>}</div></div></header>
    <main id="workspace" className="content"><Load ready={props} error={lookup.error}>{props&&<Suspense fallback={<Load ready={false}>{null}</Load>}><Routes><Route path="/" element={<Dashboard {...props}/>}/><Route path="/products" element={<Products {...props}/>}/><Route path="/products/:id" element={<ProductDetail {...props}/>}/><Route path="/locations" element={<Locations {...props}/>}/><Route path="/deliveries" element={<Deliveries {...props}/>}/><Route path="/orders" element={guard('Supervisor',<Orders key="shipping" {...props}/>)}/><Route path="/picking" element={<Orders key="picking" {...props} picking/>}/><Route path="/counts" element={guard('Supervisor',<Counts {...props}/>)}/><Route path="/suppliers" element={<Suppliers {...props}/>}/><Route path="/transactions" element={<Transactions {...props}/>}/><Route path="/reports" element={guard('Supervisor',<Reports {...props}/>)}/><Route path="/users" element={guard('Administrator',<Users {...props}/>)}/><Route path="/settings" element={guard('Administrator',<Settings {...props}/>)}/><Route path="*" element={<div className="notice error">Sidan finns inte. <Link to="/">Till översikten</Link></div>}/></Routes></Suspense>}</Load></main></div>
    {toast&&<div role="status" className="toast"><Check size={19}/>{toast}<button className="icon" aria-label="Stäng meddelande" onClick={()=>setToast('')}><X size={16}/></button></div>}
    {barcode&&<Modal title="Sök med streckkod" close={()=>setBarcode(false)}><form className="edit-form" onSubmit={async e=>{e.preventDefault();const code=String(new FormData(e.currentTarget).get('code')).trim();if(!code)return;const product=lookup.data?.products.find(p=>p.barcode===code.toUpperCase());setBarcode(false);nav(product?'/products/'+product.id:'/products'+query({search:code}))}}><p>Skanna en etikett eller skriv in streckkoden.</p><label>Streckkod<input autoFocus name="code" required/></label><button className="primary after">Sök artikel</button></form></Modal>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>);
